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
        const cdnBranchRaw = config.get('cdnBranch');
        const cdnBranch = typeof cdnBranchRaw === 'string' ? cdnBranchRaw.trim() : '';

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

        // 2. 从剪贴板获取图片或文件 (Windows PowerShell 脚本)
        const scriptPath = path.join(__dirname, 'get-clipboard.ps1');
        const tempPath = path.join(require('os').tmpdir(), `temp_image_${Date.now()}.png`);
        const resultJsonPath = path.join(require('os').tmpdir(), `clipboard_result_${Date.now()}.json`);
        
        // 创建 PowerShell 脚本来保存剪贴板图片或获取文件路径，并将结果写入 JSON 文件以避免乱码
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$clip = [System.Windows.Forms.Clipboard]

$result = @{
    status = "NoContent"
    path = ""
    type = ""
}

if ($clip::ContainsImage()) {
    $img = $clip::GetImage()
    $img.Save('${tempPath}', [System.Drawing.Imaging.ImageFormat]::Png)
    $result.status = "success"
    $result.type = "image"
    $result.path = "${tempPath}"
}
elseif ($clip::ContainsFileDropList()) {
    $files = $clip::GetFileDropList()
    if ($files.Count -gt 0) {
        $filePath = $files[0]
        $result.status = "success"
        $result.type = "file"
        $result.path = $filePath
    }
}

$result | ConvertTo-Json -Compress | Out-File -FilePath "${resultJsonPath}" -Encoding utf8
`;
        fs.writeFileSync(scriptPath, psScript);

        vscode.window.setStatusBarMessage('Processing clipboard content...', 3000);

        exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, async (err, stdout, stderr) => {
            // 清理脚本
            if(fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

            if (err) {
                outputChannel.appendLine(`PowerShell 脚本执行错误: ${err.message}`);
            }
            if (stderr) {
                outputChannel.appendLine(`PowerShell stderr: ${stderr}`);
            }

            if (!fs.existsSync(resultJsonPath)) {
                // 如果没有生成结果文件，可能是脚本执行失败
                outputChannel.appendLine('未生成结果文件，可能脚本执行失败，执行默认粘贴');
                vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                return;
            }

            let result = null;
            try {
                let jsonContent = fs.readFileSync(resultJsonPath, 'utf8');
                // 去除可能的 BOM 头 (PowerShell 5.1 Out-File -Encoding utf8 会添加 BOM)
                if (jsonContent.charCodeAt(0) === 0xFEFF) {
                    jsonContent = jsonContent.slice(1);
                }
                result = JSON.parse(jsonContent);
            } catch (e) {
                outputChannel.appendLine(`解析结果文件失败: ${e.message}`);
                // 尝试读取原始文件内容以便调试
                try {
                    const rawContent = fs.readFileSync(resultJsonPath, 'utf8');
                    outputChannel.appendLine(`原始文件内容: ${rawContent}`);
                } catch (readErr) {}
            } finally {
                // 清理结果文件
                if(fs.existsSync(resultJsonPath)) fs.unlinkSync(resultJsonPath);
            }

            if (!result || result.status !== "success") {
                outputChannel.appendLine('剪贴板里没有图片或文件，执行默认粘贴');
                vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                return;
            }

            let localFilePath = result.path;
            let isTempFile = (result.type === 'image' && localFilePath.includes('temp_image_'));

            if (!fs.existsSync(localFilePath)) {
                vscode.window.showErrorMessage('无法读取文件: ' + localFilePath);
                return;
            }

            // 检查文件大小 (限制 50MB，防止 base64 过大导致内存溢出或 GitHub API 拒绝)
            const stats = fs.statSync(localFilePath);
            const fileSizeInBytes = stats.size;
            const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
            if (fileSizeInMegabytes > 50) {
                vscode.window.showErrorMessage(`文件过大 (${fileSizeInMegabytes.toFixed(2)} MB)。GitHub API 限制上传大小。请手动上传。`);
                return;
            }

            // 检查文件类型
            const ext = path.extname(localFilePath).toLowerCase();
            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff'];
            const videoExts = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv'];
            const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
            
            let fileType = 'file';
            if (imageExts.includes(ext)) {
                fileType = 'image';
            } else if (videoExts.includes(ext)) {
                fileType = 'video';
            } else if (audioExts.includes(ext)) {
                fileType = 'audio';
            }
            
            // 如果是目录，不支持
            if (stats.isDirectory()) {
                outputChannel.appendLine(`不支持上传目录: ${localFilePath}，执行默认粘贴`);
                vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                return;
            }

            try {
                // 3. 读取文件并上传
                vscode.window.setStatusBarMessage(`Uploading ${fileType}...`, 3000);
                const fileBuffer = fs.readFileSync(localFilePath);
                const base64Content = fileBuffer.toString('base64');
                const remoteFileName = `assets/${Date.now()}${ext}`; // 存放在 assets 目录
                
                const response = await uploadToGitHub(repo, token, remoteFileName, base64Content);
                
                if (response && (response.content || response.commit)) {
                    const normalizedBranch = cdnBranch.replace(/^@/, '').replace(/^refs\/heads\//, '');
                    const branchSegment = normalizedBranch ? `@${normalizedBranch}` : '';
                    const cdnUrl = `https://cdn.jsdelivr.net/gh/${repo}${branchSegment}/${remoteFileName}`;
                    outputChannel.appendLine(`上传成功，CDN链接: ${cdnUrl}`);
                    
                    editor.edit(editBuilder => {
                        const position = editor.selection.active;
                        if (fileType === 'video') {
                            editBuilder.insert(position, `<video src="${cdnUrl}" controls width="100%"></video>`);
                        } else if (fileType === 'audio') {
                            editBuilder.insert(position, `<audio src="${cdnUrl}" controls></audio>`);
                        } else if (fileType === 'image') {
                            editBuilder.insert(position, `![](${cdnUrl})`);
                        } else {
                            // 其他文件，插入链接
                            const fileName = path.basename(localFilePath);
                            editBuilder.insert(position, `[${fileName}](${cdnUrl})`);
                        }
                    });
                    vscode.window.showInformationMessage('上传成功!');
                } else {
                    vscode.window.showErrorMessage('上传失败，请检查 Token 权限');
                }

            } catch (error) {
                vscode.window.showErrorMessage(`上传出错: ${error.message}`);
            } finally {
                // 清理临时图片
                if (isTempFile && fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            }
        });
    });

    context.subscriptions.push(disposable);
}

function uploadToGitHub(repo, token, path, content) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            message: `Upload ${path}`,
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
