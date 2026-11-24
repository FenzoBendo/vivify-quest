#include "VivifyThermal.hpp"

#include <dlfcn.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>

#include "VivifyCompat.hpp"
#include "VivifyRuntimeInternal.hpp"
#include "GlobalNamespace/LevelCompletionResults.hpp"
#include "GlobalNamespace/ResultsViewController.hpp"
#include "UnityEngine/GameObject.hpp"
#include "UnityEngine/Transform.hpp"
#include "UnityEngine/Vector2.hpp"
#include "bsml/shared/BSML.hpp"
#include "bsml/shared/BSML/Components/ModalView.hpp"
#include "bsml/shared/BSML-Lite/Creation/Buttons.hpp"
#include "bsml/shared/BSML-Lite/Creation/Layout.hpp"
#include "bsml/shared/BSML-Lite/Creation/Text.hpp"

namespace Vivify::Thermal {
namespace {

// GPU at or above this (degrees C), or Android throttling (MODERATE or
// worse), counts as hot; two minutes of it in total arms the popup.
constexpr float kHotGpuCelsius = 72.0f;
constexpr int kThermalStatusModerate = 2;  // ATHERMAL_STATUS_MODERATE
constexpr double kHotSecondsToWarn = 120.0;
constexpr double kSampleSeconds = 5.0;

using Clock = std::chrono::steady_clock;
Clock::time_point gLastSample{};
double gHotSeconds = 0.0;
bool gWarnPending = false;
bool gWarnShown = false;  // once per launch of the game
float gHottestGpu = -1.0f;
int gWorstStatus = -1;
bool gReportedSources = false;

std::optional<float> ReadCelsius(std::filesystem::path const& file) {
  std::ifstream in(file);
  long long raw = 0;
  if (!(in >> raw) || raw <= 0) return std::nullopt;
  // Millidegrees on Adreno's kgsl node and most thermal zones; a few report
  // whole degrees.
  return raw > 1000 ? static_cast<float>(raw) / 1000.0f : static_cast<float>(raw);
}

// The GPU's temperature, from the Adreno driver or a thermal zone named for
// the GPU; empty when Android does not let the game read either.
std::optional<float> GpuCelsius() {
  std::optional<float> hottest;
  auto consider = [&hottest](std::optional<float> value) {
    if (value && *value > 5.0f && *value < 150.0f) hottest = std::max(hottest.value_or(0.0f), *value);
  };
  consider(ReadCelsius("/sys/class/kgsl/kgsl-3d0/temp"));
  std::error_code ec;
  for (auto const& zone : std::filesystem::directory_iterator("/sys/class/thermal", ec)) {
    std::string const name = zone.path().filename().string();
    if (!name.starts_with("thermal_zone")) continue;
    std::ifstream typeFile(zone.path() / "type");
    std::string type;
    if (!(typeFile >> type)) continue;
    std::transform(type.begin(), type.end(), type.begin(), [](unsigned char c) { return std::tolower(c); });
    if (type.find("gpu") == std::string::npos) continue;
    consider(ReadCelsius(zone.path() / "temp"));
  }
  return hottest;
}

// Android's thermal status (AThermal, API 30), looked up at run time so the
// mod still loads where libandroid has no such function.
int ThermalStatus() {
  using Acquire = void* (*)();
  using GetStatus = int (*)(void*);
  static void* manager = nullptr;
  static GetStatus getStatus = nullptr;
  static bool tried = false;
  if (!tried) {
    tried = true;
    if (void* library = dlopen("libandroid.so", RTLD_NOW)) {
      auto acquire = reinterpret_cast<Acquire>(dlsym(library, "AThermal_acquireManager"));
      getStatus = reinterpret_cast<GetStatus>(dlsym(library, "AThermal_getCurrentThermalStatus"));
      if (acquire && getStatus) manager = acquire();
    }
  }
  return manager && getStatus ? getStatus(manager) : -1;
}

void ShowPopup(UnityEngine::Transform* parent) {
  auto* modal = BSML::Lite::CreateModal(parent, UnityEngine::Vector2(70.0f, 34.0f), nullptr, true);
  if (!modal) return;
  auto* layout = BSML::Lite::CreateVerticalLayoutGroup(modal->get_transform());
  UnityEngine::Transform* column = layout ? layout->get_transform().unsafePtr() : modal->get_transform().unsafePtr();
  BSML::Lite::CreateText(column, u"<b>Your Quest is running hot</b>");
  BSML::Lite::CreateText(column, u"<size=80%>Please let it cool down when convenient.</size>");
  SafePtrUnity<BSML::ModalView> modalPtr(modal);
  BSML::Lite::CreateUIButton(column, u"OK", [modalPtr]() {
    if (modalPtr) modalPtr->Hide();
  });
  modal->Show();
}

}  // namespace

void Sample() {
  auto const now = Clock::now();
  if (gLastSample != Clock::time_point{}) {
    double const since = std::chrono::duration<double>(now - gLastSample).count();
    if (since < kSampleSeconds) return;
    gLastSample = now;
    auto const gpu = GpuCelsius();
    int const status = ThermalStatus();
    if (!gReportedSources) {
      gReportedSources = true;
      PaperLogger.info("Vivify heat: GPU temperature {}, Android thermal status {}",
                       gpu ? fmt::format("{:.0f} C", *gpu) : std::string("not readable"),
                       status >= 0 ? std::to_string(status) : std::string("not available"));
    }
    if (gpu && *gpu > gHottestGpu) gHottestGpu = *gpu;
    gWorstStatus = std::max(gWorstStatus, status);
    bool const hot = (gpu && *gpu >= kHotGpuCelsius) || status >= kThermalStatusModerate;
    // Seconds away (the menu, a pause longer than a sample) are not counted.
    if (hot) gHotSeconds += std::min(since, kSampleSeconds * 2.0);
    if (!gWarnPending && !gWarnShown && gHotSeconds >= kHotSecondsToWarn) {
      gWarnPending = true;
      PaperLogger.warn("Vivify heat: hot for {:.0f} s (GPU up to {:.0f} C, thermal status up to {}); the next "
                       "cleared level asks to let the Quest cool",
                       gHotSeconds, gHottestGpu, gWorstStatus);
    }
    return;
  }
  gLastSample = now;
}

}  // namespace Vivify::Thermal

MAKE_HOOK_MATCH(Thermal_ResultsDidActivate, &GlobalNamespace::ResultsViewController::DidActivate, void,
                GlobalNamespace::ResultsViewController* self, bool firstActivation, bool addedToHierarchy,
                bool screenSystemEnabling) {
  Thermal_ResultsDidActivate(self, firstActivation, addedToHierarchy, screenSystemEnabling);
  using namespace Vivify::Thermal;
  if (!gWarnPending || gWarnShown) return;
  try {
    auto* results = self->____levelCompletionResults;
    if (results == nullptr ||
        results->levelEndStateType != GlobalNamespace::LevelCompletionResults::LevelEndStateType::Cleared)
      return;
    gWarnShown = true;
    gWarnPending = false;
    PaperLogger.info("Vivify heat: asking to let the Quest cool (shown once until the game restarts)");
    ShowPopup(self->get_transform().unsafePtr());
  } catch (...) {
    PaperLogger.warn("Vivify heat: the cool-down popup could not be shown");
  }
}

void Vivify::Thermal::InstallHooks() {
  INSTALL_HOOK(PaperLogger, Thermal_ResultsDidActivate);
}
