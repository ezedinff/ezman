# ezman

A lightweight desktop API client with a local MCP server for AI agents. Built with Tauri, React, and Rust.

## Features

- Organize requests into collections and folders.
- Use environments, variables, authentication, and JSON or GraphQL bodies.
- Import Postman v2.1 collections.
- Let AI agents manage collections and execute saved requests through MCP.

Data is stored locally in `~/.ezman/`. No account required.

## Run locally

Install Rust, Node.js, npm, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/ezedinff/ezman.git
cd ezman/apps/desktop
npm ci
npm run tauri dev
```

## Connect an AI agent

Build the MCP server from the repository root:

```bash
cargo build --release -p ezman-mcp-server
```

Add it to your MCP client's configuration (for example, Cursor's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ezman": {
      "command": "/absolute/path/to/ezman/target/release/ezman-mcp",
      "args": []
    }
  }
}
```

Restart your MCP client, then ask your agent to list your collections or create a request.
When environments exist, executing a request requires an explicit environment or `"none"`.

**Secrets are restricted by default.** Enable **Allow MCP secret access** in a collection's settings or the environment editor to let agents read and change its secrets. Agents cannot enable this themselves. Saved requests can still use secrets; this setting does not restrict where authenticated requests are sent.

## Tests

```bash
cargo test -p ezman-core -p ezman-mcp-server
```

## License

[MIT](LICENSE)
