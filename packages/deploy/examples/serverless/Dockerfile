# [WebServer 镜像函数](https://cloud.tencent.com/document/product/583/56051)
# ------ 阶段 1:  生成、迁移数据库、打包可执行文件 ------
FROM oven/bun:latest as builder

WORKDIR /root/workspace/

COPY . .

RUN bun install --frozen-lockfile --production
RUN bun run build

# ------ 阶段 2: 将制品生成为最终镜像 ------
FROM oven/bun:latest as prod

WORKDIR /root/workspace/
COPY --from=0 /root/workspace/dist/* ./
RUN chmod -R u=rwx . /root/workspace/

ENV HOST 0.0.0.0
# WebServer 镜像函数：镜像中需包含 Http Server 并监听 9000 端口
ENV PORT 9000

CMD ["bun", "run", "./index.js"]
    