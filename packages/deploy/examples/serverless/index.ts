import { formatDate } from 'date-fns'

console.log('YUNLEFUN 启动成功')

Bun.serve({
  port: 9000, // SCF 要求端口号固定为 9000
  fetch(req) {
    console.log(req)
    return new Response(`Hello World! ${formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')}`)
  },
})
