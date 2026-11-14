# CN-AIR 本地镜像（`data/cn-air`）

全国城市日 CSV 的上游镜像是 [GewisLab/CN-AIR](https://atomgit.com/GewisLab/CN-AIR)（AtomGit）。本仓库**不提交** `data/cn-air/`（体积约 1–2 GB、内嵌 Git + LFS），而是用脚本在本机稀疏检出。

`npm run history` 的产出是本地的 `data/quotsoft-history.sqlite`（不入 Git）。**从原始 CSV 重建**或**大规模补缺**时建议先跑本脚本；若已有历史库、只补最近几天，可直接 `npm run data:update`。

## 前置条件

- [Git](https://git-scm.com/)
- [Git LFS](https://git-lfs.com/)（CSV 由 LFS 存储，未安装会只有指针文件）

## 一键克隆 / 更新

在项目根目录：

```bash
npm run data:cn-air
```

Windows 也可双击或任务计划运行 `scripts/clone-cn-air.cmd`。

脚本会：

1. 将 CN-AIR 浅克隆到 `data/cn-air`（已存在则 `fetch` + `pull`）
2. 根据当前 `HEAD` 自动列出全部 `城市_*` 年度目录并写入 sparse-checkout
3. 执行 `git lfs pull` 拉取真实 CSV

自定义上游（很少需要）：

```bash
CN_AIR_REMOTE=https://atomgit.com/GewisLab/CN-AIR.git npm run data:cn-air
```

## 入库

```bash
npm run history -- --national
```

`download-quotsoft` 会先扫描 `data/cn-air` 下的 `china_cities_YYYYMMDD.csv`，再对缺失日从 quotsoft 下载。仅吃本地、不访问远端：

```bash
HISTORY_SKIP_REMOTE=1 npm run history -- --national
```

## 故障排查

| 现象 | 处理 |
|------|------|
| CSV 只有一百多字节、首行 `version https://git-lfs` | 安装 Git LFS 后重新 `npm run data:cn-air` |
| `git pull` 失败 | 不要在 `data/cn-air` 里手改文件；删掉目录后重跑 `npm run data:cn-air` |
| 克隆很慢 | 正常，LFS 需拉取数千个日文件；可通宵跑一次 |
| `No 城市_* folders found at CN-AIR HEAD`（多见于 GitHub Actions） | 稀疏克隆在部分 Git 版本上无法列出根目录；请使用最新版 `clone-cn-air.ts`（会回退到已知 `城市_*` 列表），并删掉 `data/cn-air` 后重跑 |

许可与署名见 [licenses.md](licenses.md)。