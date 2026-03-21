# GitHub Paste Plugin (GitHub 图片粘贴插件)

这是一个 VS Code 扩展，允许你将剪贴板中的图片直接粘贴并上传到 GitHub 仓库，同时自动在 Markdown 文件中插入 jsDelivr CDN 链接。

## 功能特性

- **自动图片上传**：检测剪贴板中的图片并将其上传到指定的 GitHub 仓库。
- **视频上传支持**：支持复制视频文件（.mp4, .mov, .webm 等）并上传，自动插入 `<video>` 标签。
- **音频上传支持**：支持复制音频文件（.mp3, .wav 等）并上传，自动插入 `<audio>` 标签。
- **其他文件支持**：支持复制其他类型文件（如 .pdf, .zip, .docx）上传，自动插入下载链接。
- **智能粘贴**：如果剪贴板中包含文本，则执行标准粘贴操作。只有检测到图片或文件时才会触发上传。
- **CDN 加速**：插入上传图片的 `jsDelivr` 链接，确保图片加载速度快。
- **时间戳命名**：根据当前时间戳自动命名文件，避免文件名冲突。
- **Markdown 支持**：专为 Markdown 编辑（`.md` 文件）设计。

## 前置条件

- **VS Code**：版本 1.70.0 或更高。
- **GitHub 账号**：你需要一个 GitHub 账号来存储图片。
- **Personal Access Token (PAT)**：一个具有 `repo` 权限的 GitHub Token，用于上传文件。
- **PowerShell**：提取剪贴板图片所需（Windows 环境）。

## 配置指南

在使用该插件之前，你必须在 VS Code 中配置你的 GitHub 凭据和仓库设置。

1.  **生成 GitHub Token**：
    - 前往 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)。
    - 生成一个新 Token (Classic)。
    - 勾选 **`repo`** 权限范围（对私有仓库的完全控制）。
    - 复制生成的 Token。

2.  **配置 VS Code 设置**：
    - 打开 VS Code 设置 (`Ctrl+,`)。
    - 搜索 `githubPastePlugin`。
    - **Github Paste Plugin: Token**：在此处粘贴你的 GitHub Personal Access Token。
    - **Github Paste Plugin: Repo**：输入你想用来存储图片的仓库（格式：`用户名/仓库名`，例如 `johndoe/my-image-assets`）。
    - **Github Paste Plugin: Cdn Branch**：可选，填写分支名（例如 `main`）。建议填写以避免默认分支变更导致 404。

## 使用方法

1.  打开一个 Markdown 文件 (`.md`)。
2.  截图或复制图片到剪贴板。
3.  按下 `Ctrl+V`（macOS 上为 `Cmd+V`）。
4.  插件将执行以下操作：
    - 检查剪贴板中是否有文本。如果有，直接粘贴文本。
    - 如果没有文本，则将图片、视频或文件上传到你配置的 GitHub 仓库（存放在 `assets/` 目录下）。
    - 如果是图片，插入 Markdown 图片链接。
    - 如果是视频，插入 HTML `<video>` 标签。
    - 如果是音频，插入 HTML `<audio>` 标签。
    - 如果是其他文件，插入文件下载链接。

   ```markdown
   ![](https://cdn.jsdelivr.net/gh/username/repository@main/assets/1678899000000.png)
   
   <!-- 视频 -->
   <video src="https://cdn.jsdelivr.net/gh/username/repository@main/assets/1678899000000.mp4" controls width="100%"></video>

   <!-- 音频 -->
   <audio src="https://cdn.jsdelivr.net/gh/username/repository@main/assets/1678899000000.mp3" controls></audio>
   
   <!-- 其他文件 -->
   [document.pdf](https://cdn.jsdelivr.net/gh/username/repository@main/assets/1678899000000.pdf)
   ```

## 开发

1.  克隆仓库。
2.  运行 `npm install` 安装依赖。
3.  按 `F5` 启动调试并打开一个新的扩展开发宿主窗口。
