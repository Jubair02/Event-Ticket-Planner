#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.zscripts" && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

TARGET="$SCRIPT_DIR/database-runtime-build.sh"

# 项目已迁移到托管 Postgres：该步骤只校验 DATABASE_URL，
# 不再复制/初始化任何数据库文件。

# 1) 环境变量提供 Postgres 连接串时应通过，且不在产物中创建 db 目录。
PROJECT="$TEST_ROOT/p1"
BUILD="$TEST_ROOT/b1"
mkdir -p "$PROJECT"

DATABASE_URL="postgresql://user:pw@example.neon.tech/neondb?sslmode=require" \
    PROJECT_DIR="$PROJECT" BUILD_DIR="$BUILD" bash "$TARGET"

test ! -e "$BUILD/db"
test ! -e "$BUILD/db/custom.db"

# 2) 环境变量缺失时应回退读取 PROJECT_DIR/.env。
PROJECT="$TEST_ROOT/p2"
BUILD="$TEST_ROOT/b2"
mkdir -p "$PROJECT"
printf 'DATABASE_URL="postgres://user:pw@example.neon.tech/neondb"\n' >"$PROJECT/.env"

env -u DATABASE_URL PROJECT_DIR="$PROJECT" BUILD_DIR="$BUILD" bash "$TARGET"

# 3) 既无环境变量也无 .env 时应失败。
PROJECT="$TEST_ROOT/p3"
BUILD="$TEST_ROOT/b3"
mkdir -p "$PROJECT"

if env -u DATABASE_URL PROJECT_DIR="$PROJECT" BUILD_DIR="$BUILD" bash "$TARGET" >/dev/null 2>&1; then
    echo "expected failure when DATABASE_URL is missing" >&2
    exit 1
fi

# 4) 仍指向 SQLite 文件时应失败，避免静默部署到空的本地库。
PROJECT="$TEST_ROOT/p4"
BUILD="$TEST_ROOT/b4"
mkdir -p "$PROJECT"

if DATABASE_URL="file:/app/db/custom.db" \
    PROJECT_DIR="$PROJECT" BUILD_DIR="$BUILD" bash "$TARGET" >/dev/null 2>&1; then
    echo "expected failure for SQLite DATABASE_URL" >&2
    exit 1
fi

# 5) 无法识别的协议应失败。
PROJECT="$TEST_ROOT/p5"
BUILD="$TEST_ROOT/b5"
mkdir -p "$PROJECT"

if DATABASE_URL="mysql://user:pw@example.com/db" \
    PROJECT_DIR="$PROJECT" BUILD_DIR="$BUILD" bash "$TARGET" >/dev/null 2>&1; then
    echo "expected failure for non-Postgres DATABASE_URL" >&2
    exit 1
fi

echo "database runtime build tests passed"
