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
ENV PORT 9000

CMD ["bun", "run", "./index.js"]
    