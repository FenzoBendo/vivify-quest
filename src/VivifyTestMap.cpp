// Settings > Test Vivify (0.15.2): installs the Vivify Quest test map.
//
// The map (testmap/ in the repository) is built by CI and shipped inside the
// QMOD as VivifyTestMap.zip, which the mod loader copies beside the logs. This
// unpacks it into SongCore's CustomLevels as "VivifyTest" and refreshes the
// song list. The song is a commercial track and never ships: the player's own
// copy (an .ogg or .egg named after the song, in the Vivify folder, Download
// or Music) becomes the map's song.egg.
#include "VivifyRuntimeInternal.hpp"
#include "VivifyZip.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <thread>

namespace Vivify {
namespace {

constexpr char const* kVivifyFolder = "/sdcard/ModData/com.beatgames.beatsaber/Mods/Vivify";
constexpr char const* kLevelFolder = "/sdcard/ModData/com.beatgames.beatsaber/Mods/SongCore/CustomLevels/VivifyTest";

std::string Lower(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return text;
}

// The player's copy of the song: TestMapSong.ogg/.egg in the Vivify folder, or
// an .ogg/.egg whose name mentions the song in Download or Music.
std::filesystem::path FindSong() {
  std::error_code ec;
  for (char const* name : {"TestMapSong.ogg", "TestMapSong.egg"}) {
    auto path = std::filesystem::path(kVivifyFolder) / name;
    if (std::filesystem::is_regular_file(path, ec)) return path;
  }
  for (char const* folder : {kVivifyFolder, "/sdcard/Download", "/sdcard/Music"}) {
    for (auto const& entry : std::filesystem::directory_iterator(folder, ec)) {
      if (!entry.is_regular_file(ec)) continue;
      std::string const name = Lower(entry.path().filename().string());
      std::string const ext = Lower(entry.path().extension().string());
      if (ext != ".ogg" && ext != ".egg") continue;
      if (name.find("sense of me") != std::string::npos || name.find("sense_of_me") != std::string::npos ||
          name.find("chemicals") != std::string::npos) {
        return entry.path();
      }
    }
  }
  return {};
}

}  // namespace

void InstallTestMap(std::function<void(std::string const&)> status) {
  std::thread([status = std::move(status)]() {
    auto report = [&status](std::string const& text) {
      PaperLogger.info("Vivify Test Vivify: {}", text);
      BSML::MainThreadScheduler::Schedule([status, text] { status(text); });
    };
    std::error_code ec;
    auto const zipPath = std::filesystem::path(kVivifyFolder) / "VivifyTestMap.zip";
    if (!std::filesystem::is_regular_file(zipPath, ec)) {
      report("This build has no test map (it comes with builds made after the map's bundle was built)");
      return;
    }
    std::ifstream in(zipPath, std::ios::binary);
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::filesystem::path const level(kLevelFolder);
    std::filesystem::create_directories(level, ec);
    std::string error;
    if (!ExtractZip(std::span<uint8_t const>(data.data(), data.size()), level, error)) {
      report("Could not unpack the test map: " + error);
      return;
    }
    bool haveSong = std::filesystem::is_regular_file(level / "song.egg", ec);
    if (!haveSong) {
      auto const song = FindSong();
      if (!song.empty()) {
        std::filesystem::copy_file(song, level / "song.egg", std::filesystem::copy_options::overwrite_existing, ec);
        haveSong = !ec;
      }
    }
    BSML::MainThreadScheduler::Schedule([] { SongCore::API::Loading::RefreshSongs(false); });
    if (haveSong) {
      report("Installed: Custom Levels > \"The Sense of Me / Chemicals\" (Vivify Test)");
    } else {
      report("Installed, but no song: put your own .ogg of the song at Mods/Vivify/TestMapSong.ogg and press "
             "Test Vivify again");
    }
  }).detach();
}

}  // namespace Vivify
