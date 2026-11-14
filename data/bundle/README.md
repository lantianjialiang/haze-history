# Pages 部署用 SQLite 压缩包

GitHub Pages 不能跑 Node API，但 **Deploy Pages** 会在构建前解压这些文件，再导出 JSON 打进 `web/dist`。

## 更新压缩包（维护者）

本机已有 `data/quotsoft-history.sqlite`（及可选 `data/embassy-history.sqlite`）后：

```bash
npm run data:pack
git add data/bundle/*.gz
git commit -m "update data bundles"
```

## 部署 / 本地静态构建

```bash
npm run data:unpack    # 解压到 data/*.sqlite（已存在且较新则跳过）
npm run build:static
```

压缩包**可以且应该**提交到 Git；解压后的 `data/*.sqlite` 仍在 `.gitignore` 里。