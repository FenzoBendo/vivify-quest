#pragma once

// The game's mirrors on the Quest (0.15.54). See VivifyMirrorLayout.hpp for
// what the test measures. Beat Saber 1.40.8 only; 1.45.3 draws mirrors with
// URP and none of this runs there.

#include "VivifyMirrorLayout.hpp"

namespace UnityEngine {
class RenderTexture;
class Texture;
}  // namespace UnityEngine

namespace Vivify::MirrorProbe {

// From the main camera's OnRenderImage while a level plays: once a game
// mirror has drawn, draws its material over the test texture, in two-eye and
// in one-eye form, reads the result back and records what the mirror has to
// change. Runs once per launch of the game (the shader is the game's own).
void Run(UnityEngine::RenderTexture* eyeTexture);

// What the two-eye and one-eye programs need; nullptr until measured, or when
// the measurement did not match a layout the mirror can be drawn in.
MirrorLayout::StereoRemedy const* Stereo();
MirrorLayout::MonoRemedy const* Mono();

// A game mirror drew a reflection this level; while the test is still to
// run, the main camera's effect pass stays on so it can run (Wanted).
void NoteMirrorDrawn();
bool Wanted();

// Turns a mirror's freshly drawn reflection texture upside down in place.
void FlipVertically(UnityEngine::Texture* texture);

}  // namespace Vivify::MirrorProbe
