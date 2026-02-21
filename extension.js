const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

function activate(context) {
    const outputChannel = vscode.window.createOutputChannel("GitHub Paste Plugin");
    let disposable = vscode.commands.registerCommand('extension.pasteImageToGitHub', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // 1. 获取配置
        const config = vscode.workspace.getConfiguration('githubPastePlugin');
        const token = config.get('token');
        const repo = config.get('repo');

        if (!token || !repo) {
            vscode.window.showErrorMessage('请先在设置中配置 githubPastePlugin.token 和 githubPastePlugin.repo');
            return;
        }

        // 0. 优先检查剪贴板文本
        // 如果剪贴板里有文本，说明用户可能在粘贴代码或文字，此时直接调用原生粘贴，不走图片上传流程
        // 这样可以避免每次粘贴文本时都要运行 PowerShell 脚本带来的延迟
        const clipboardText = await vscode.env.clipboard.readText();
        if (clipboardText && clipboardText.trim().length > 0) {
             outputChannel.appendLine(`检测到剪贴板文本: "${clipboardText.substring(0, 20)}..."，执行默认粘贴`);
             await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
             return;
        }

        // 2. 从剪贴板获取图片 (Windows PowerShell 脚本)
        const scriptPath = path.join(__dirname, 'get-image.ps1');
        const tempPath = path.join(require('os').tmpdir(), `temp_image_${Date.now()}.png`);
        
        // 创建简单的 PowerShell 脚本来保存剪贴板图片
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $img.Save('${tempPath}', [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Saved"
} else {
    Write-Output "NoImage"
}
`;
        fs.writeFileSync(scriptPath, psScript);

        vscode.window.setStatusBarMessage('Uploading image...', 3000);

        exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, async (err, stdout, stderr) => {
            // 清理脚本
            if(fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

            if (stdout.trim().includes("NoImage")) {
                // 如果没有图片，也执行默认粘贴（防止误判）
                outputChannel.appendLine('剪贴板里没有图片，执行默认粘贴');
                vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                return;
            }

            if (!fs.existsSync(tempPath)) {
                vscode.window.showErrorMessage('无法保存剪贴板图片');
                return;
            }

            try {
                // 3. 读取图片并上传
                const imageBuffer = fs.readFileSync(tempPath);
                const base64Image = imageBuffer.toString('base64');
                const fileName = `assets/${Date.now()}.png`; // 存放在 assets 目录
                
                const response = await uploadToGitHub(repo, token, fileName, base64Image);
                
                if (response && (response.content || response.commit)) {
                    // 4. 插入 Markdown 链接
                    // 使用 jsDelivr CDN 加速
                    // 格式: https://cdn.jsdelivr.net/gh/user/repo/path (不指定分支，自动用默认分支)
                    const cdnUrl = `https://cdn.jsdelivr.net/gh/${repo}/${fileName}`;
                    outputChannel.appendLine(`上传成功，CDN链接: ${cdnUrl}`);
                    
                    editor.edit(editBuilder => {
                        const position = editor.selection.active;
                        editBuilder.insert(position, `![](${cdnUrl})`);
                    });
                    vscode.window.showInformationMessage('图片上传成功!');
                } else {
                    vscode.window.showErrorMessage('上传失败，请检查 Token 权限');
                }

            } catch (error) {
                vscode.window.showErrorMessage(`上传出错: ${error.message}`);
            } finally {
                // 清理临时图片
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }
        });
    });

    context.subscriptions.push(disposable);
}

function uploadToGitHub(repo, token, path, content) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            message: `Upload image ${path}`,
            content: content
        });

        const options = {
            hostname: 'api.github.com',
            path: `/repos/${repo}/contents/${path}`,
            method: 'PUT',
            headers: {
                'User-Agent': 'VSCode-Extension',
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(body));
                } else {
                    reject(new Error(`Status Code: ${res.statusCode}, Body: ${body}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}
