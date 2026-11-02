import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const repo = process.env.GITHUB_REPOSITORY;
const [owner, repository] = repo.split("/");
const issue = event.issue;
const action = event.action;
const isCommentEvent = process.env.GITHUB_EVENT_NAME === "issue_comment";
const githubToken = process.env.GITHUB_TOKEN;
const discordToken = process.env.DISCORD_BOT_TOKEN;
const forumId = process.env.DISCORD_FORUM_CHANNEL_ID;
const markerPattern = /<!-- discord-forum-thread:(\\d+) starter:(\\d+) -->/;

if (!issue || issue.pull_request) {
  console.log("Not an issue event; skipping.");
  process.exit(0);
}
if (!githubToken || !discordToken || !forumId) {
  throw new Error("Missing GITHUB_TOKEN, DISCORD_BOT_TOKEN, or DISCORD_FORUM_CHANNEL_ID.");
}

async function request(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": `Bearer ${githubToken}`,
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${method} ${url} failed (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

async function discord(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      "Authorization": `Bot ${discordToken}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Discord API ${method} ${path} failed (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

const api = `https://api.github.com/repos/${owner}/${repository}`;
const issueUrl = issue.html_url;
const issueNumber = issue.number;

function clean(value = "") {
  return String(value).replace(/@everyone/g, "@\u200beveryone").replace(/@here/g, "@\u200bhere");
}
function truncate(value, max = 1850) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max - 20) + "\n… (truncated)" : text;
}
function labelsText() {
  const labels = (issue.labels || []).map(label => typeof label === "string" ? label : label.name);
  const assignees = (issue.assignees || []).map(user => user.login);
  return [
    `**State:** ${issue.state === "closed" ? "Closed" : "Open"}`,
    `**Labels:** ${labels.length ? labels.join(", ") : "None"}`,
    `**Assignees:** ${assignees.length ? assignees.join(", ") : "Unassigned"}`
  ].join("\n");
}
function issueContent() {
  const body = truncate(issue.body || "_No description provided._", 1250);
  return truncate(
    `**[ #${issueNumber} ] ${clean(issue.title)}**\n${issueUrl}\n\n${body}\n\n---\n${labelsText()}`,
    1950
  );
}

async function findMapping() {
  let page = 1;
  while (page <= 10) {
    const comments = await request(`${api}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
    for (const comment of comments) {
      const match = comment.body?.match(markerPattern);
      if (match) return { threadId: match[1], starterId: match[2] };
    }
    if (comments.length < 100) break;
    page++;
  }
  return null;
}

async function saveMapping(threadId, starterId) {
  const marker = `<!-- discord-forum-thread:${threadId} starter:${starterId} -->`;
  await request(`${api}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: { body: `Discord forum thread linked: https://discord.com/channels/@me/${threadId}\n\n${marker}` }
  });
}

async function createThread() {
  const created = await discord(`/channels/${forumId}/threads`, {
    method: "POST",
    body: {
      name: `#${issueNumber} · ${clean(issue.title).slice(0, 85)}`.slice(0, 100),
      auto_archive_duration: 10080,
      message: { content: issueContent(), allowed_mentions: { parse: [] } }
    }
  });
  const starterId = created.message?.id;
  if (!created.id || !starterId) {
    throw new Error("Discord did not return a forum thread ID and starter message ID.");
  }
  await saveMapping(created.id, starterId);
  console.log(`Created Discord forum thread ${created.id} for issue #${issueNumber}.`);
  return { threadId: created.id, starterId };
}

let mapping = await findMapping();

if (isCommentEvent) {
  const comment = event.comment;
  if (comment?.body?.includes("<!-- discord-forum-thread:")) {
    console.log("Integration mapping comment; skipping.");
    process.exit(0);
  }
  if (!mapping) {
    console.log("No linked Discord thread exists yet; skipping comment event.");
    process.exit(0);
  }
  if (action === "deleted") {
    await discord(`/channels/${mapping.threadId}/messages`, {
      method: "POST",
      body: { content: `A GitHub comment by **${clean(comment?.user?.login || "a user")}** was deleted.\n${issueUrl}`, allowed_mentions: { parse: [] } }
    });
  } else if (action === "created" || action === "edited") {
    const heading = action === "edited" ? "GitHub comment edited" : "New GitHub comment";
    await discord(`/channels/${mapping.threadId}/messages`, {
      method: "POST",
      body: {
        content: truncate(`**${heading} — ${clean(comment.user?.login || "Unknown user")}**\n${issueUrl}\n\n${comment.body || "_Empty comment_"}`, 1950),
        allowed_mentions: { parse: [] }
      }
    });
  }
  console.log(`Synced comment event '${action}' for issue #${issueNumber}.`);
  process.exit(0);
}

if (action === "opened" && !mapping) {
  mapping = await createThread();
} else if (!mapping) {
  console.log(`No Discord thread mapping for issue #${issueNumber}; action '${action}' skipped.`);
  process.exit(0);
}

if (action === "deleted") {
  await discord(`/channels/${mapping.threadId}`, { method: "DELETE" });
  console.log(`Deleted Discord thread for deleted issue #${issueNumber}.`);
  process.exit(0);
}

if (action === "closed") {
  await discord(`/channels/${mapping.threadId}`, { method: "PATCH", body: { archived: true, locked: false } });
} else if (action === "reopened") {
  await discord(`/channels/${mapping.threadId}`, { method: "PATCH", body: { archived: false, locked: false } });
}

if (action !== "opened") {
  await discord(`/channels/${mapping.threadId}/messages/${mapping.starterId}`, {
    method: "PATCH",
    body: { content: issueContent(), allowed_mentions: { parse: [] } }
  });
  await discord(`/channels/${mapping.threadId}/messages`, {
    method: "POST",
    body: {
      content: `GitHub issue updated: **${clean(action)}**\n${issueUrl}\n${labelsText()}`,
      allowed_mentions: { parse: [] }
    }
  });
}
console.log(`Synced issue #${issueNumber} action '${action}'.`);
