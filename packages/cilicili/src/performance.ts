/**
 * 函数耗时统计
 */
export function performance(target: any, key: string, descriptor: PropertyDescriptor) {
  const fn = descriptor.value
  descriptor.value = async function (...args: any[]) {
    const start = Date.now()
    const result = await fn.apply(this, args)
    const end = Date.now()
    console.info(`%c${key} %c${end - start}ms`, 'color: #0e93e0', 'color: #e0a80e')
    return result
  }
  return descriptor
}

export function time(func: (...args: any[]) => any) {
  return function (this: any, ...args: any[]) {
    const start = Date.now()
    const result = func.apply(this, args)
    const end = Date.now()
    console.info(`%c${func.name} %c${end - start}ms`, 'color: #0e93e0', 'color: #e0a80e')
    return result
  }
}
