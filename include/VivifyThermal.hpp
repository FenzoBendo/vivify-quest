#pragma once

// Headset heat (0.15.52). While a Vivify map plays, the GPU temperature and
// Android's thermal status are sampled every few seconds. After the headset
// has been hot for a while, the next cleared level's results screen shows one
// popup asking to let the Quest cool when convenient: once per launch of the
// game.
namespace Vivify::Thermal {

// Called every frame of a Vivify level; samples every 5 s.
void Sample();
// Installs the results-screen hook that shows the popup.
void InstallHooks();

}  // namespace Vivify::Thermal
