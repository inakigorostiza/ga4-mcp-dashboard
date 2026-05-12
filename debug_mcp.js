require('dotenv').config();
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function test() {
    const IS_CLOUD_RUN = process.env.K_SERVICE !== undefined;
    const DATA_DIR = IS_CLOUD_RUN ? '/tmp' : __dirname;
    const USER_CREDS_PATH = path.join(DATA_DIR, '.user_credentials.json');

    const env = { ...process.env };
    if (fs.existsSync(USER_CREDS_PATH)) {
        env.GOOGLE_APPLICATION_CREDENTIALS = USER_CREDS_PATH;
        console.log('Using user credentials from:', USER_CREDS_PATH);
    }

    const transport = new StdioClientTransport({
        command: 'analytics-mcp',
        args: [],
        env: env
    });

    const client = new Client({
        name: 'debug-client',
        version: '1.0.0'
    }, {
        capabilities: {}
    });

    try {
        await client.connect(transport);
        console.log('Connected to analytics-mcp');

        // List available tools
        const tools = await client.listTools();
        console.log('\n=== Available Tools ===');
        tools.tools.forEach(tool => {
            console.log(`\nTool: ${tool.name}`);
            console.log(`Description: ${tool.description}`);
            console.log('Input schema:', JSON.stringify(tool.inputSchema, null, 2));
        });

        // Try calling get_account_summaries with empty object
        console.log('\n=== Calling get_account_summaries ===');
        const result = await client.callTool({
            name: 'get_account_summaries',
            arguments: {}
        });
        console.log('Result:', JSON.stringify(result, null, 2));

        await client.close();
    } catch (error) {
        console.error('Error:', error.message);
        if (error.data) {
            console.error('Error data:', error.data);
        }
    }
}

test();
