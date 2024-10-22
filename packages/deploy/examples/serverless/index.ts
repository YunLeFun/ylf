console.log('YUNLEFUN 启动成功')

Bun.serve({
  port: 9000, // SCF 要求端口号固定为 9000
  fetch(req) {
    console.log(req)
    return new Response('Hello World!')
  },
})
