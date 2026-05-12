const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
const os = require('os');

async function test() {
    const credPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
    
    const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credPath };
    
    const transport = new StdioClientTransport({
        command: 'analytics-mcp',
        args: [],
        env: env
    });
    
    const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    
    try {
        await client.connect(transport);
        console.log('✅ Connected to analytics-mcp\n');
        
        const result = await client.callTool({ name: 'get_account_summaries', arguments: {} });
        
        console.log('=== RESULT STRUCTURE ===');
        console.log('isError:', result.isError);
        console.log('content items:', result.content ? result.content.length : 0);
        
        if (result.content && result.content.length > 0) {
            console.log('\n=== FIRST ITEM ===');
            console.log('Type:', result.content[0].type);
            console.log('Text length:', result.content[0].text ? result.content[0].text.length : 0);
            console.log('First 400 chars:', result.content[0].text?.substring(0, 400));
        }
        
        // Try to parse the full concatenated response
        if (result.content) {
            let fullText = '';
            result.content.forEach(item => {
                if (item.text) fullText += item.text;
            });
            
            console.log('\n=== PARSING ===');
            console.log('Total concatenated length:', fullText.length);
            
            try {
                const parsed = JSON.parse(fullText);
                console.log('✅ Valid JSON (direct parse)');
                console.log('Type:', Array.isArray(parsed) ? 'ARRAY' : 'OBJECT');
                if (Array.isArray(parsed)) {
                    console.log('Array length:', parsed.length);
                    console.log('\n=== GA4 ACCOUNTS ===');
                    parsed.forEach((account, i) => {
                        const dispName = account.display_name || account.displayName || 'Unknown';
                        const propCount = (account.property_summaries || account.propertySummaries || []).length;
                        console.log(`${i+1}. ${dispName} (${propCount} properties)`);
                    });
                } else {
                    console.log('Object keys:', Object.keys(parsed).slice(0, 10));
                }
            } catch (e) {
                console.log('❌ Direct parse failed');
                console.log('Error:', e.message.substring(0, 150));
                
                try {
                    const parsed = JSON.parse('[' + fullText + ']');
                    console.log('\n✅ Valid JSON (wrapped in array brackets)');
                    console.log('Array length:', parsed.length);
                    console.log('\n=== GA4 ACCOUNTS ===');
                    parsed.forEach((account, i) => {
                        const dispName = account.display_name || account.displayName || 'Unknown';
                        const propCount = (account.property_summaries || account.propertySummaries || []).length;
                        console.log(`${i+1}. ${dispName} (${propCount} properties)`);
                    });
                } catch (e2) {
                    console.log('❌ Array wrapper also failed');
                    console.log('Error:', e2.message.substring(0, 150));
                }
            }
        }
        
        await client.close();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

test();
