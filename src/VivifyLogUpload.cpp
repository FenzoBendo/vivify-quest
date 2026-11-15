#include "VivifyLogUpload.hpp"

#include "VivifyTypes.hpp"
#include "main.hpp"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <random>
#include <sstream>
#include <thread>
#include <vector>

#include "beatsaber-hook/shared/config/rapidjson-utils.hpp"

namespace Vivify::LogUpload {
namespace {

// The relay accepts 4.5 MiB of text per request. Keep requests smaller so
// JSON escaping cannot push the HTTP body over the relay's body-size limit.
constexpr std::uintmax_t kMaxFileBytes = 1536 * 1024;
constexpr std::uintmax_t kAutoUploadBytes = 4 * 1024 * 1024;
constexpr std::uintmax_t kManualUploadBytes = 2 * kAutoUploadBytes;
constexpr std::uintmax_t kRequestTextBytes = 3 * 1024 * 1024;
constexpr size_t kMaxFilesPerRequest = 12;

struct UploadFile {
  std::string name;
  std::string sourceName;
  std::uintmax_t from = 0;
  std::string text;
};

struct UploadConfig {
  std::string directory;
  std::string relayUrl;
  std::string version;
  bool lite = false;
};

UploadConfig gConfig;
std::mutex gConfigMutex;
std::atomic<bool> gConfigured{false};
std::atomic<bool> gUploadRunning{false};

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

// Only Vivify-owned diagnostic files are uploaded. The session file is
// included alongside the persistent global history and per-level reports.
std::vector<std::filesystem::path> Candidates(std::filesystem::path const& directory) {
  std::vector<std::filesystem::path> files;
  for (char const* name : {"VivifyCrash.txt", "VivifyReport.txt", "RecoveryMaps.txt", "PlayingLevel.txt",
                           "VivifySession.txt"}) {
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

std::string PartName(std::string const& name, std::uintmax_t offset, bool split) {
  if (!split) return name;
  auto const dot = name.rfind(".txt");
  std::string const stem = dot == std::string::npos ? name : name.substr(0, dot);
  std::uintmax_t const part = offset / kMaxFileBytes + 1;
  char suffix[24];
  std::snprintf(suffix, sizeof(suffix), "-part%03llu", static_cast<unsigned long long>(part));
  return stem + suffix + ".txt";
}

bool PostBatch(UploadConfig const& config, std::vector<UploadFile> const& batch) {
  if (batch.empty()) return true;
  rapidjson::Document body(rapidjson::kObjectType);
  auto& allocator = body.GetAllocator();
  body.AddMember("version", rapidjson::Value(config.version.c_str(), allocator), allocator);
  body.AddMember("lite", config.lite, allocator);
  std::string const uploadId = RandomId();
  body.AddMember("upload", rapidjson::Value(uploadId.c_str(), allocator), allocator);
  rapidjson::Value files(rapidjson::kArrayType);
  std::uintmax_t total = 0;
  for (auto const& entry : batch) {
    rapidjson::Value file(rapidjson::kObjectType);
    file.AddMember("name", rapidjson::Value(entry.name.c_str(), allocator), allocator);
    file.AddMember("from", static_cast<uint64_t>(entry.from), allocator);
    file.AddMember("text", rapidjson::Value(entry.text.c_str(), static_cast<rapidjson::SizeType>(entry.text.size()), allocator),
                   allocator);
    files.PushBack(file, allocator);
    total += entry.text.size();
  }
  body.AddMember("files", files, allocator);
  rapidjson::StringBuffer buffer;
  rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
  body.Accept(writer);
  std::span<uint8_t const> const payload(reinterpret_cast<uint8_t const*>(buffer.GetString()), buffer.GetSize());

  WebUtils::URLOptions options(config.relayUrl, WebUtils::URLOptions::QueryMap{},
                               WebUtils::URLOptions::HeaderMap{{"Content-Type", "application/json"}}, false, "",
                               std::nullopt, 90);
  options.noEscape = true;
  auto response = WebUtils::Post<WebUtils::StringResponse>(options, payload);
  if (!response.IsSuccessful()) {
    PaperLogger.warn("Vivify Send Logs: upload failed (http {}, curl {})",
                     response.get_HttpCode(), response.get_CurlStatus());
    return false;
  }
  PaperLogger.info("Vivify Send Logs: uploaded {} file part(s), {} KB ({})", batch.size(), total / 1024,
                   response.responseData ? *response.responseData : std::string("accepted"));
  return true;
}

void Run(UploadConfig config, bool manual) {
  std::filesystem::path const dir(config.directory);
  std::filesystem::path const statePath = dir / "LogUpload.state";
  auto state = ReadState(statePath);
  auto next = state;
  std::vector<UploadFile> pending;
  std::uintmax_t total = 0;
  std::map<std::string, std::uintmax_t> manualCompleted;
  std::uintmax_t const totalLimit = manual ? kManualUploadBytes : kAutoUploadBytes;

  for (auto const& path : Candidates(dir)) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec)) continue;
    std::uintmax_t const size = std::filesystem::file_size(path, ec);
    if (ec || size == 0) continue;
    std::string const sourceName = path.filename().string();
    std::uintmax_t from = manual ? 0 : (state.count(sourceName) ? state[sourceName] : 0);
    if (from > size) from = 0;
    if (!manual && from == size) continue;

    // Automatic uploads keep their previous newest-tail behavior per file.
    // Manual uploads start at byte zero and split large files into numbered
    // pieces so every piece fits the relay's per-file limit.
    if (!manual && size - from > kMaxFileBytes) from = size - kMaxFileBytes;
    while (from < size && total < totalLimit) {
      std::uintmax_t const length = std::min<std::uintmax_t>(
          {kMaxFileBytes, size - from, totalLimit - total});
      if (length == 0) break;
      std::ifstream in(path, std::ios::binary);
      if (!in) break;
      in.seekg(static_cast<std::streamoff>(from));
      std::string text(static_cast<size_t>(length), '\0');
      in.read(text.data(), static_cast<std::streamsize>(length));
      text.resize(static_cast<size_t>(in.gcount()));
      if (text.empty()) break;

      bool const split = size > kMaxFileBytes;
      UploadFile entry;
      entry.name = PartName(sourceName, from, split);
      entry.sourceName = sourceName;
      entry.from = from;
      entry.text = std::move(text);
      total += entry.text.size();
      from += entry.text.size();
      pending.push_back(std::move(entry));
      if (!manual) break;
    }
    if (manual && from >= size) manualCompleted[sourceName] = size;
    if (total >= totalLimit) break;
  }

  if (pending.empty()) {
    PaperLogger.info("Vivify Send Logs: no {} logs to upload", manual ? "available" : "new");
    return;
  }

  // Multiple small requests let a manual upload carry twice as much as an
  // automatic upload without ever exceeding the relay's per-request limit.
  std::vector<UploadFile> batch;
  std::uintmax_t batchBytes = 0;
  for (auto const& entry : pending) {
    if (!batch.empty() && (batch.size() >= kMaxFilesPerRequest ||
                           batchBytes + entry.text.size() > kRequestTextBytes)) {
      if (!PostBatch(config, batch)) return;
      if (!manual) {
        for (auto const& sent : batch) next[sent.sourceName] = sent.from + sent.text.size();
        WriteState(statePath, next);
      }
      batch.clear();
      batchBytes = 0;
    }
    batchBytes += entry.text.size();
    batch.push_back(entry);
  }
  if (!PostBatch(config, batch)) return;
  if (manual) {
    for (auto const& [name, size] : manualCompleted) next[name] = size;
    // Manual uploads are intentionally full-file uploads; recording offsets
    // avoids immediately sending the same data again at the next map end.
    WriteState(statePath, next);
  } else {
    for (auto const& sent : batch) next[sent.sourceName] = sent.from + sent.text.size();
    WriteState(statePath, next);
  }
  if (total >= totalLimit) {
    PaperLogger.info("Vivify Send Logs: reached the {} MB upload limit; use the menu button for the larger manual upload",
                     totalLimit / (1024 * 1024));
  }
}

void BeginUpload(bool manual) {
  if (!gConfigured.load()) {
    PaperLogger.warn("Vivify Send Logs: uploader is not configured");
    return;
  }
  if (!GetSendLogs()) {
    PaperLogger.info("Vivify Send Logs: disabled in Vivify settings");
    return;
  }
  if (!manual && !GetVivifyDebugLogging()) return;
  if (gConfig.relayUrl.empty()) {
    PaperLogger.info("Vivify Send Logs: this build has no log relay address");
    return;
  }
  if (gUploadRunning.exchange(true)) {
    PaperLogger.info("Vivify Send Logs: an upload is already running");
    return;
  }
  UploadConfig config;
  {
    std::lock_guard lock(gConfigMutex);
    config = gConfig;
  }
  std::thread([config = std::move(config), manual]() {
    try {
      Run(config, manual);
    } catch (std::exception const& error) {
      PaperLogger.warn("Vivify Send Logs: failed: {}", error.what());
    } catch (...) {
      PaperLogger.warn("Vivify Send Logs: failed");
    }
    gUploadRunning.store(false);
  }).detach();
}

}  // namespace

void StartIfEnabled(std::string const& directory, std::string const& relayUrl, std::string const& version,
                    bool lite) {
  {
    std::lock_guard lock(gConfigMutex);
    gConfig = {directory, relayUrl, version, lite};
  }
  gConfigured.store(true);
  // Retry any data left behind by a previous failed upload.
  BeginUpload(false);
}

void UploadManual() {
  BeginUpload(true);
}

void UploadAfterLevelEnd() {
  BeginUpload(false);
}

}  // namespace Vivify::LogUpload
