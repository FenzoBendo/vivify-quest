#pragma once
// Send Logs (0.15.20): when the game starts, with Debug Logging and Send Logs
// both on, what Vivify has logged since the last upload is sent to the log
// relay (tools/log-relay), which commits it to the repository's LOGS branch.
// The relay holds the GitHub token; the mod only knows the relay's address.
//
// Only Vivify's own files are read, and only what was added since the last
// upload (LogUpload.state keeps how far each file has been sent), capped per
// file and per upload. Runs on a thread of its own; a failure is logged and
// retried at the next start.

#include <string>

namespace Vivify::LogUpload {

// `directory`: Vivify's log folder. `relayUrl` empty: nothing is sent.
void StartIfEnabled(std::string const& directory, std::string const& relayUrl, std::string const& version,
                    bool lite);

}  // namespace Vivify::LogUpload
