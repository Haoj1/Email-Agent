#!/bin/bash

# 前端部署脚本：S3 + CloudFront
# 使用方法: ./deploy.sh yourdomain.com

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查参数
if [ -z "$1" ]; then
    echo -e "${RED}错误: 请提供 S3 bucket 名称${NC}"
    echo "使用方法: ./deploy.sh yourdomain.com"
    exit 1
fi

BUCKET_NAME=$1
DISTRIBUTION_ID=${2:-""}  # CloudFront Distribution ID (可选)

echo -e "${GREEN}开始部署前端到 S3...${NC}"

# 检查是否已构建
if [ ! -d "build" ]; then
    echo -e "${YELLOW}未找到 build 目录，开始构建...${NC}"
    npm run build
fi

# 上传文件到 S3
echo -e "${GREEN}上传文件到 S3: ${BUCKET_NAME}${NC}"
aws s3 sync build/ s3://${BUCKET_NAME}/ --delete

# 设置正确的 Content-Type
echo -e "${GREEN}设置文件 Content-Type...${NC}"
aws s3 cp build/index.html s3://${BUCKET_NAME}/index.html --content-type "text/html" --cache-control "no-cache"

# 上传 CSS 文件
if [ -d "build/static/css" ]; then
    aws s3 cp build/static/css/ s3://${BUCKET_NAME}/static/css/ --recursive --content-type "text/css"
fi

# 上传 JS 文件
if [ -d "build/static/js" ]; then
    aws s3 cp build/static/js/ s3://${BUCKET_NAME}/static/js/ --recursive --content-type "application/javascript"
fi

# 上传其他静态资源（图片等）
if [ -d "build/static/media" ]; then
    aws s3 cp build/static/media/ s3://${BUCKET_NAME}/static/media/ --recursive
fi

# 如果提供了 CloudFront Distribution ID，创建失效
if [ ! -z "$DISTRIBUTION_ID" ]; then
    echo -e "${GREEN}创建 CloudFront 缓存失效...${NC}"
    aws cloudfront create-invalidation --distribution-id ${DISTRIBUTION_ID} --paths "/*"
    echo -e "${GREEN}缓存失效已创建，通常需要几分钟生效${NC}"
fi

echo -e "${GREEN}✅ 部署完成！${NC}"
echo -e "${YELLOW}提示: 如果使用 CloudFront，记得创建缓存失效或等待自动更新${NC}"
