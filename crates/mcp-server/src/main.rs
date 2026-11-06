use std::sync::Arc;
use ezman_core::StorageManager;
use ezman_mcp_server::EzmanMcpServer;
use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    tracing::info!("Starting EZMan MCP Server (stdio transport)...");

    let storage = Arc::new(StorageManager::new()?);
    let server = EzmanMcpServer::new(storage);

    let running = server.serve(rmcp::transport::stdio()).await?;
    running.waiting().await?;

    Ok(())
}
