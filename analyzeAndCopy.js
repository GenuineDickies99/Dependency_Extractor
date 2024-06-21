const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const readlineSync = require('readline-sync');
require('dotenv').config();

const currentDir = __dirname;
const parentDir = path.resolve(currentDir, '..');
const baseDestDir = path.join(currentDir, 'isolated_code_block');

const copyFileSafely = (srcPath, relativeDestPath) => {
    let relativePath = path.relative(path.dirname(srcPath), relativeDestPath);
    let destPath = path.join(baseDestDir, relativePath);

    let normalizedDestPath = path.normalize(destPath);
    let normalizedBaseDestDir = path.normalize(baseDestDir);

    while (!normalizedDestPath.startsWith(normalizedBaseDestDir)) {
        destPath = path.join(baseDestDir, path.basename(relativePath));
        normalizedDestPath = path.normalize(destPath);
    }

    try {
        fs.ensureDirSync(path.dirname(destPath));
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied ${srcPath} to ${destPath}`);
    } catch (error) {
        console.error(`Failed to copy ${srcPath} to ${destPath}: ${error.message}`);
    }
};

const fetchDependencies = async (codeBlock, mainFileName) => {
    const dependencies = await analyzeCode(codeBlock);

    const dependencyPaths = dependencies.split('\n')
        .map(dep => sanitizePath(dep))
        .filter(dep => isValidPath(dep) && fs.existsSync(path.resolve(parentDir, dep)));

    for (const dep of dependencyPaths) {
        const srcPath = path.resolve(parentDir, dep);
        const relativeDestPath = path.relative(parentDir, srcPath);

        copyFileSafely(srcPath, relativeDestPath);
    }

    const mainFilePath = path.resolve(parentDir, mainFileName);
    const relativeMainFilePath = path.relative(parentDir, mainFilePath);

    copyFileSafely(mainFilePath, relativeMainFilePath);
};

const analyzeCode = async (codeBlock) => {
    const apiKey = process.env.OPENAI_API_KEY;
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const prompt = `
Analyze the following code block and list all the relative paths of dependencies (CSS and JS files) required to be ported.
Respond with only the paths in a plain text format, one per line, without any additional text, formatting, or explanation.
Do not include any bullet points, dashes, quotes, or other extraneous characters.
The response should only contain valid relative paths that can be directly used in the file system.
Including anything more than valid paths will confuse the application.
Here is the code to be analyzed:

${codeBlock}

Example response:
./assets/css/style.css
./assets/js/main.js
./assets/images/logo.png
../scripts/util.js
../styles/theme.css
`;

    try {
        const response = await axios.post(endpoint, {
            model: 'gpt-4o',
            messages: [
                { role: "system", content: "You are a code analyzer, skilled in identifying dependencies in code blocks." },
                { role: "user", content: prompt }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error calling OpenAI API:', error);
        throw error;
    }
};

const sanitizePath = (p) => {
    return p.replace(/[<>:"|?*`]/g, '').trim();
};

const isValidPath = (p) => {
    const validExtensions = ['.css', '.js', '.html', '.jpg', '.jpeg', '.png', '.svg'];
    return p && (p.startsWith('./') || p.startsWith('../') || p.match(/^[\w\-/\\]+(\.\w+)?$/)) && validExtensions.some(ext => p.endsWith(ext));
};

const start = async () => {
    fs.emptyDirSync(baseDestDir);

    const codeBlockFilePath = path.resolve(currentDir, 'codeblock.txt');
    if (!fs.existsSync(codeBlockFilePath)) {
        console.error('Error: codeblock.txt file not found.');
        return;
    }

    const codeBlock = fs.readFileSync(codeBlockFilePath, 'utf8');

    const mainFileName = readlineSync.question('Enter the name of the main file (e.g., index.html): ');

    const mainFilePath = path.resolve(parentDir, mainFileName);
    if (!fs.existsSync(mainFilePath)) {
        console.error(`Error: Main file ${mainFileName} does not exist.`);
        return;
    }

    await fetchDependencies(codeBlock, mainFileName);

    console.log('All files and dependencies have been copied successfully.');
};

start().catch(error => {
    console.error('Error during the process:', error);
});