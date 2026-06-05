import { describe, expect, it, vi } from 'vitest'
import { performance, sleep, time } from '../src'

describe('performance', () => {
  it('time 包装函数：透传参数与返回值', () => {
    const fn = vi.fn((a: number, b: number) => a + b)
    const wrapped = time(fn)
    expect(wrapped(2, 3)).toBe(5)
    expect(fn).toHaveBeenCalledWith(2, 3)
  })

  it('performance 作为方法装饰器：不影响返回值', async () => {
    class Demo {
      @performance
      async run(x: number) {
        await sleep(5)
        return x * 2
      }
    }
    expect(await new Demo().run(21)).toBe(42)
  })

  it('sleep 至少等待指定毫秒', async () => {
    const start = Date.now()
    await sleep(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })
})
