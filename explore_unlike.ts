import { PlaywrightMCP } from './src/browser.js';
import { browserSession, runWithTimeout } from './src/runtime.js';
import * as fs from 'fs';

async function main() {
    console.log("Starting browser session...");
    await browserSession(PlaywrightMCP, async (page) => {
        await page.goto('https://x.com/vikingmute/status/2033156347504767135');
        await page.wait(5); // Wait for hydration
        
        console.log("Clicking like...");
        const result = await page.evaluate(`(async () => {
            let likeBtn = document.querySelector('[data-testid="like"]');
            if (likeBtn) likeBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            
            const elements = document.querySelectorAll('*[data-testid]');
            const testIds = Array.from(elements).map(el => el.getAttribute('data-testid'));
            const uniqueIds = [...new Set(testIds)];
            
            return { uniqueIds };
        })()`);
        
        fs.writeFileSync('unlike_testids.json', JSON.stringify(result, null, 2));
        console.log(`Saved resulting test ids to unlike_testids.json`);
    });
}

main().catch(console.error);
