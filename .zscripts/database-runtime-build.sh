#!/bin/bash

set -euo pipefail

# 数据库已迁移到托管 Postgres（Neon），不再随部署产物打包 SQLite 文件。
# 构建期只校验 DATABASE_URL，不对线上库执行 schema 变更——生产环境的
# schema 同步由人工执行 `bun run db:push` / `prisma migrate deploy` 完成，
# 避免每次部署都可能改动生产数据。
PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"

mkdir -p "$BUILD_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
    if [ -f "$PROJECT_DIR/.env" ]; then
        DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$PROJECT_DIR/.env" | tail -n1 | sed 's/^["'\'']//; s/["'\'']$//')"
    fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "❌ 未找到 DATABASE_URL（既不在环境变量中，也不在 $PROJECT_DIR/.env 内）"
    echo "   当前项目使用托管 Postgres，部署前必须提供 DATABASE_URL"
    exit 1
fi

case "$DATABASE_URL" in
    postgres://*|postgresql://*)
        echo "🗄️  数据库: 托管 Postgres（不随产物打包）"
        ;;
    file:*)
        echo "❌ DATABASE_URL 仍指向 SQLite 文件: $DATABASE_URL"
        echo "   项目已迁移到 Postgres，请更新 DATABASE_URL"
        exit 1
        ;;
    *)
        echo "❌ 无法识别的 DATABASE_URL 协议: $DATABASE_URL"
        exit 1
        ;;
esac

echo "✅ 数据库配置校验通过"
