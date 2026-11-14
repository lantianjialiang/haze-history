# 本机历史数据库

`data/quotsoft-history.sqlite`（约 150 MB）和 `data/embassy-history.sqlite`（约 40 MB）**不入 Git**。克隆仓库后需在本机构建，网站与 `npm run build:static` 才具备完整历史曲线。

## 监测总站归档（必需）

任选一种方式。

### 推荐：CN-AIR 本地镜像 + 入库

```bash
npm run data:cn-air                    # Git + Git LFS，约 1–2 GB，见 cn-air-clone.md
npm run history -- --national        # 从 CSV 写入 quotsoft-history.sqlite
npm run data:update                  # 补最近几天全国日值（可选）
```

### 无 CN-AIR：仅从 quotsoft 拉取

```bash
npm run history -- --national
```

较慢，且依赖 quotsoft 限流策略。可调 `HISTORY_CONCURRENCY`、`HISTORY_DELAY_MS`。

### 仅增量 / 续传

已有库时可直接：

```bash
npm run data:update
```

或指定起点：`npm run history -- --national --from=2026-01-01`。

## 美国使馆 PM2.5（可选）

五城使馆源需要：

```bash
npm run data:embassy
```

## 校验

- 开发模式：`http://127.0.0.1:5173/api/history-coverage`
- 静态导出前确认库存在：`Test-Path data/quotsoft-history.sqlite`（PowerShell）

## 备份

SQLite 文件请自行备份或放在同步盘；`data/archive/` 与 `data/recent/` 在 Git 里只覆盖近期快照，不能替代全国历史库。