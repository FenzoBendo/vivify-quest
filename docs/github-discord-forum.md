# GitHub Issues → Discord Forum

This repository can mirror GitHub issues into a Discord **Forum** channel. Each issue gets one forum post/thread; comments are sent into that thread.

## Required GitHub Actions secrets

In **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | Token for your Discord bot (keep it private) |
| `DISCORD_FORUM_CHANNEL_ID` | ID of the target Discord Forum channel |

The workflow uses GitHub's automatically provided `GITHUB_TOKEN`; no extra GitHub token is needed.

## Discord bot setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and add a bot.
2. Copy the bot token into the `DISCORD_BOT_TOKEN` GitHub secret. Never commit the token.
3. Enable Developer Mode in Discord (User Settings → Advanced), right-click the Forum channel, and choose **Copy Channel ID**. Save that as `DISCORD_FORUM_CHANNEL_ID`.
4. Invite the bot to your server using OAuth2 URL Generator with the `bot` scope and these permissions:
   - View Channel
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Manage Threads (needed to archive and reopen threads)
5. Make sure the bot's role can access the Forum channel.

## GitHub Actions permissions

The workflow requests `issues: write` so it can store a small hidden mapping comment on each GitHub issue. That comment records the Discord thread and starter-message IDs; it prevents duplicate forum posts and lets later events find the existing thread.

If organization or repository policy restricts workflow permissions, allow GitHub Actions to read and write repository contents/issues as needed, or explicitly enable write permissions for Actions.

## What gets synchronized

- Issue opened: creates one Forum post containing the title, description, link, state, labels, and assignees.
- Issue edited, assigned, unassigned, labeled, unlabeled, milestone, lock, and related issue events: refreshes the original Forum post and adds an event note.
- GitHub comment created or edited: posts the comment into the matching Forum thread.
- GitHub comment deleted: posts a deletion notice.
- Issue closed: archives the Forum thread.
- Issue reopened: unarchives the Forum thread.
- Issue deleted: deletes its Discord thread.

Pull request events are ignored.

## Test it

1. Add both Discord secrets.
2. Open a test issue in this repository.
3. Open the Discord Forum channel; a post named `#<number> · <issue title>` should appear.
4. Add a comment to the GitHub issue and confirm it appears in the same Discord thread.
5. Close and reopen the issue to test archiving and unarchiving.

Workflow runs are available under the repository's **Actions** tab. A failed run includes the API error needed to diagnose missing permissions or an incorrect channel ID.
