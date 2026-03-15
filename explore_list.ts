import { PlaywrightMCP } from './src/browser.js';
import { browserSession } from './src/runtime.js';
import * as fs from 'fs';

async function main() {
    console.log("Starting browser session...");
    await browserSession(PlaywrightMCP, async (page) => {
        await page.installInterceptor('graphql');

        console.log("Navigating to user lists...");
        await page.goto('https://x.com/jakevin7/lists');
        await page.wait(5); // Wait for list APIs to load

        const requests = await page.getInterceptedRequests();
        const listRequests = requests.filter((r: any) => 
            r.url.includes('ListsManagementPageTimeline') || 
            r.url.includes('List')
        );
        fs.writeFileSync('list_payload.json', JSON.stringify(listRequests, null, 2));
        console.log(`Captured ${listRequests.length} List requests. Saved to list_payload.json`);
    });
}

main().catch(console.error);
