#include "VivifyLogUpload.hpp"

#include "VivifyTypes.hpp"
#include "main.hpp"

#include <algorithm>
#include <atomic>
#include <filesystem>
#include <fstream>
#include <map>
#include <random>
#include <sstream>
#include <thread>
#include <vector>

#include "beatsaber-hook/shared/config/rapidjson-utils.hpp"

namespace Vivify::LogUpload {
namespace {

// Per file and per upload; the relay refuses more than kMaxTotalBytes as well.
constexpr std::uintmax_t kMaxFileBytes = 1536 * 1024;
constexpr std::uintmax_t kMaxTotalBytes = 4 * 1024 * 1024;

std::atomic<bool> gStarted = false;

std::map<std::string, std::uintmax_t> ReadState(std::filesystem::path const& path) {
  std::map<std::string, std::uintmax_t> state;
  std::ifstream in(path);
  std::string line;
  while (std::getline(in, line)) {
    auto const tab = line.find('\t');
    if (tab == std::string::npos) continue;
    try {
      state[line.substr(0, tab)] = std::stoull(line.substr(tab + 1));
    } catch (...) {
    }
  }
  return state;
}

void WriteState(std::filesystem::path const& path, std::map<std::string, std::uintmax_t> const& state) {
  std::ofstream out(path, std::ios::trunc);
  for (auto const& [name, offset] : state) out << name << '\t' << offset << '\n';
}

// The files that are sent, most useful first: the total cap drops what is
// further down the list. The global log's parts are newest first.
std::vector<std::filesystem::path> Candidates(std::filesystem::path const& directory) {
  std::vector<std::filesystem::path> files;
  for (char const* name : {"VivifyCrash.txt", "VivifyReport.txt", "RecoveryMaps.txt", "PlayingLevel.txt"}) {
    files.push_back(directory / name);
  }
  std::vector<std::filesystem::path> parts;
  std::error_code ec;
  for (auto const& entry : std::filesystem::directory_iterator(directory, ec)) {
    std::string const name = entry.path().filename().string();
    if (name.rfind("vivify_global", 0) == 0 && entry.path().extension() == ".txt") parts.push_back(entry.path());
  }
  std::sort(parts.begin(), parts.end(), [](auto const& a, auto const& b) {
    std::error_code e1, e2;
    return std::filesystem::last_write_time(a, e1) > std::filesystem::last_write_time(b, e2);
  });
  files.insert(files.end(), parts.begin(), parts.end());
  return files;
}

std::string RandomId() {
  std::random_device device;
  std::mt19937_64 random(device());
  char buffer[17];
  std::snprintf(buffer, sizeof(buffer), "%016llx", static_cast<unsigned long long>(random()));
  return buffer;
}

void Run(std::string directory, std::string relayUrl, std::string version, bool lite) {
  std::filesystem::path const dir(directory);
  std::filesystem::path const statePath = dir / "LogUpload.state";
  auto state = ReadState(statePath);
  auto next = state;

  rapidjson::Document body(rapidjson::kObjectType);
  auto& allocator = body.GetAllocator();
  body.AddMember("version", rapidjson::Value(version.c_str(), allocator), allocator);
  body.AddMember("lite", lite, allocator);
  body.AddMember("upload", rapidjson::Value(RandomId().c_str(), allocator), allocator);
  rapidjson::Value files(rapidjson::kArrayType);

  std::uintmax_t total = 0;
  for (auto const& path : Candidates(dir)) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec)) continue;
    std::uintmax_t const size = std::filesystem::file_size(path, ec);
    if (ec) continue;
    std::string const name = path.filename().string();
    std::uintmax_t from = state.count(name) ? state[name] : 0;
    if (from > size) from = 0;  // a new file under the same name
    if (from == size) continue;
    // Only the last kMaxFileBytes of what is new.
    if (size - from > kMaxFileBytes) from = size - kMaxFileBytes;
    std::uintmax_t const length = size - from;
    if (total + length > kMaxTotalBytes) continue;
    std::ifstream in(path, std::ios::binary);
    if (!in) continue;
    in.seekg(static_cast<std::streamoff>(from));
    std::string text(length, '\0');
    in.read(text.data(), static_cast<std::streamsize>(length));
    text.resize(static_cast<size_t>(in.gcount()));
    if (text.empty()) continue;
    rapidjson::Value file(rapidjson::kObjectType);
    file.AddMember("name", rapidjson::Value(name.c_str(), allocator), allocator);
    file.AddMember("from", static_cast<uint64_t>(from), allocator);
    file.AddMember("text", rapidjson::Value(text.c_str(), static_cast<rapidjson::SizeType>(text.size()), allocator),
                   allocator);
    files.PushBack(file, allocator);
    total += text.size();
    next[name] = from + text.size();
  }
  if (files.Empty()) {
    PaperLogger.info("Vivify Send Logs: nothing new to send");
    return;
  }
  size_t const count = files.Size();
  body.AddMember("files", files, allocator);
  rapidjson::StringBuffer buffer;
  rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
  body.Accept(writer);
  std::span<uint8_t const> const payload(reinterpret_cast<uint8_t const*>(buffer.GetString()), buffer.GetSize());

  WebUtils::URLOptions options(relayUrl, WebUtils::URLOptions::QueryMap{},
                               WebUtils::URLOptions::HeaderMap{{"Content-Type", "application/json"}}, false, "",
                               std::nullopt, 60);
  options.noEscape = true;
  auto response = WebUtils::Post<WebUtils::StringResponse>(options, payload);
  if (!response.IsSuccessful()) {
    PaperLogger.warn("Vivify Send Logs: the relay did not take the logs (http {}, curl {}); trying again next start",
                     response.get_HttpCode(), response.get_CurlStatus());
    return;
  }
  WriteState(statePath, next);
  PaperLogger.info("Vivify Send Logs: sent {} file(s), {} KB, to the LOGS branch{}", count, total / 1024,
                   response.responseData ? " (" + *response.responseData + ")" : std::string());
}

}  // namespace

void StartIfEnabled(std::string const& directory, std::string const& relayUrl, std::string const& version,
                    bool lite) {
  if (gStarted.exchange(true)) return;
  if (!GetVivifyDebugLogging() || !GetSendLogs()) return;
  if (relayUrl.empty()) {
    PaperLogger.info("Vivify Send Logs: on, but this build has no log relay address; nothing is sent");
    return;
  }
  std::thread([directory, relayUrl, version, lite]() {
    try {
      Run(directory, relayUrl, version, lite);
    } catch (std::exception const& error) {
      PaperLogger.warn("Vivify Send Logs: failed: {}", error.what());
    } catch (...) {
      PaperLogger.warn("Vivify Send Logs: failed");
    }
  }).detach();
}

}  // namespace Vivify::LogUpload
