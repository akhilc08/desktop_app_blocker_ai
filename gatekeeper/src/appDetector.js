const { execSync } = require("child_process");
const { spawn } = require("child_process");

// Common app name to process name mappings
const COMMON_APPS = {
    "Google Chrome": ["chrome.exe"],
    "Microsoft Edge": ["msedge.exe"],
    "Firefox": ["firefox.exe"],
    "Discord": ["discord.exe"],
    "Slack": ["slack.exe"],
    "Spotify": ["spotify.exe"],
    "Steam": ["steam.exe"],
    "Visual Studio Code": ["code.exe"],
    "Notepad": ["notepad.exe"],
    "Calculator": ["calc.exe"],
    "Paint": ["mspaint.exe"],
    "Word": ["winword.exe"],
    "Excel": ["excel.exe"],
    "PowerPoint": ["powerpnt.exe"],
    "Outlook": ["outlook.exe"],
    "Teams": ["Teams.exe"],
    "Zoom": ["Zoom.exe"],
    "Telegram": ["Telegram.exe"],
    "VLC": ["vlc.exe"],
    "CCleaner": ["CCleaner.exe"],
    "7-Zip": ["7zFM.exe"],
    "WinRAR": ["WinRAR.exe"],
    "League of Legends": ["LeagueClient.exe", "LeagueClientUx.exe", "LeagueClientUxRender.exe", "League of Legends.exe", "RiotClientServices.exe"],
    "Riot Client": ["RiotClientServices.exe"],
    "Adobe Reader": ["AcroRd32.exe"],
    "Adobe Acrobat": ["Acrobat.exe", "AcroRd32.exe"],
    "Adobe Acrobat Reader": ["AcroRd32.exe", "Acrobat.exe"],
    "Adobe Acrobat Reader DC": ["AcroRd32.exe", "Acrobat.exe"],
    "Adobe Acrobat DC": ["Acrobat.exe", "AcroRd32.exe"],
    "Adobe Photoshop": ["Photoshop.exe"]
};

function getProcessNamesForApp(appName) {
    // Check if it's a known app
    if (COMMON_APPS[appName]) {
        return COMMON_APPS[appName];
    }

    // Try fuzzy match against known app names
    const lower = String(appName || "").toLowerCase();
    const fuzzyMatches = [];
    for (const key of Object.keys(COMMON_APPS)) {
        if (lower.includes(key.toLowerCase())) {
            fuzzyMatches.push(...COMMON_APPS[key]);
        }
    }
    if (fuzzyMatches.length > 0) {
        return Array.from(new Set(fuzzyMatches));
    }

    // Try to generate a reasonable guess from the app name
    const guesses = [];

    // Lowercase version
    guesses.push(appName.toLowerCase().replace(/\s+/g, "") + ".exe");

    // With spaces removed and .exe
    guesses.push(appName.replace(/\s+/g, "") + ".exe");

    // First word + .exe
    const firstWord = appName.split(/\s+/)[0];
    if (firstWord) {
        guesses.push(firstWord.toLowerCase() + ".exe");
        guesses.push(firstWord + ".exe");
    }

    return guesses;
}

function findAppExecutable(appName) {
    try {
        if (process.platform !== "win32") {
            return null;
        }

        // Try to find the app's executable in Program Files
        const processNames = getProcessNamesForApp(appName);

        for (const procName of processNames) {
            try {
                // Check common installation locations
                const locations = [
                    `C:\\Program Files (x86)\\${appName}`,
                    `C:\\Program Files\\${appName}`,
                    `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Programs\\${appName}`
                ];

                for (const loc of locations) {
                    try {
                        const files = execSync(`dir "${loc}" /b /s *.exe`, { encoding: "utf8" });
                        if (files) {
                            return files.split("\n")[0].trim();
                        }
                    } catch (e) {
                        // Location doesn't exist
                    }
                }
            } catch (e) {
                // Continue to next guess
            }
        }
    } catch (e) {
        console.error("Error finding app executable:", e);
    }

    // Return the most likely process name
    return getProcessNamesForApp(appName)[0];
}

module.exports = {
    getProcessNamesForApp,
    findAppExecutable
};
