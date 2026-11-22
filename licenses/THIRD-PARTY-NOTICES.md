# Third-party license inventory

This directory records licenses and notices for third-party code, headers, libraries,
assets, generated code, tools, and copied/ported implementation used by Vivify Quest.
Entries marked **VERIFY** require checking the exact restored source revision/license
before release. Do not treat this inventory as a legal conclusion.

## Dependency manifest (scripts/dependencies.json and qpm.json)

| Component | Source / upstream | License status |
|---|---|---|
| beatsaber-hook | https://github.com/QuestPackageManager/beatsaber-hook | VERIFY pinned source/release |
| bs-cordl | https://github.com/QuestPackageManager/bs-cordl | VERIFY pinned source |
| BSML / Quest-BSML | https://github.com/bsq-ports/Quest-BSML | VERIFY pinned source/release |
| conditional-dependencies | QPM package (fork/source resolved by restore scripts) | VERIFY resolved package |
| config-utils | https://github.com/darknight1050/config-utils | VERIFY pinned source |
| cpp-semver | QPM package (fork/source resolved by restore scripts) | VERIFY resolved package |
| CustomJSONData | https://github.com/bsq-ports/CustomJSONData | VERIFY pinned source/release |
| Il2CppQuestTypePatching / custom-types | https://github.com/QuestPackageManager/Il2CppQuestTypePatching | VERIFY pinned source/release |
| Flamingo | https://github.com/sc2ad/Flamingo | VERIFY pinned source |
| fmt | QPM package (fork/source resolved by restore scripts) | VERIFY pinned source/version |
| libil2cpp | Unity IL2CPP headers/runtime source | VERIFY Unity license and distribution terms |
| MetaCore | https://github.com/Metalit/MetaCore | VERIFY pinned source/release |
| paper2_scotland2 / paperlog | https://github.com/Fernthedev/paperlog | VERIFY pinned source |
| utfCpp (paperlog submodule) | https://github.com/nemtrif/utfcpp | VERIFY pinned submodule license |
| RapidjsonMacros | https://github.com/Metalit/RapidjsonMacros | VERIFY pinned source |
| scotland2 | https://github.com/sc2ad/scotland2 | VERIFY pinned source/release |
| Sombrero | https://github.com/Fernthedev/Sombrero-quest | VERIFY pinned source |
| SongCore | https://github.com/raineaeternal/Quest-SongCore | VERIFY pinned source/release |
| tinyxml2 | https://github.com/MillzyDev/NDK-tinyxml2 | VERIFY pinned source/release |
| Tracks | https://github.com/bsq-ports/Tracks | VERIFY pinned source/release |
| WebUtils | https://github.com/bsq-ports/WebUtils | VERIFY pinned source/release |
| RapidJSON (beatsaber-hook submodule) | https://github.com/Tencent/rapidjson | VERIFY pinned commit |
| utfCpp (paperlog submodule) | https://github.com/nemtrif/utfcpp | VERIFY pinned commit |

## Other source, tools, and embedded material

| Component | Location / upstream | License status |
|---|---|---|
| BeatLeader Quest BSOR replay model, encoder and recorder hooks | See `beatleader-qmod-MIT.txt`; https://github.com/BeatLeader/beatleader-qmod | MIT; notice file included |
| bcdec texture decoder | `third_party/bcdec.h` | VERIFY and include upstream notice |
| UnityPy type-tree/common-string reference material | converter fixtures and tools | VERIFY package/repository license and restrictions |
| DepthBlit shader/resource adapted from PC | `assets/depth/` and `tools/separate-eye/` | VERIFY original source license and preserve attribution |
| Unity / IL2CPP generated headers and metadata | `extern/includes/libil2cpp/` | VERIFY Unity terms and redistribution permissions |
| Python scripts and bundled tool dependencies | `scripts/`, `tools/`, workflows | Inventory third-party Python packages separately; project-authored scripts are covered by root license unless stated |
| Android NDK / LLVM / build tools | CI/build environment | Not redistributed as project source unless explicitly vendored; review packaging |
| External QMODs / shared libraries included in releases | QPM dependency manifest and packaging scripts | Verify every bundled binary's corresponding source license and redistribution terms |

## Audit policy

- Keep a copy of the **full license text** for every redistributed third-party component in this folder, using upstream's license filename where practical.
- Keep copyright, attribution, patent, trademark, notice, and source-offer requirements intact.
- Include dependencies used only as headers, submodules, generated/ported snippets, assets, shaders, tests, or tools—not only runtime libraries.
- Resolve **VERIFY** entries against the exact commit/package revision actually restored by CI. Do not guess license identifiers from project names.
- Record the component, version/ref/hash, SPDX identifier if confirmed, upstream URL, license filename, and whether source or binary is redistributed.
- This inventory is a starting point; unresolved entries mean the license bundle is not yet complete.
