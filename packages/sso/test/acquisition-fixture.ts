import type { AcquisitionContext } from '../src/acquisition'

export const acquisition: AcquisitionContext = {
  version: 1,
  firstTouch: {
    capturedAt: 1000,
    landingHost: 'cook.yunle.fun',
    landingPath: '/random',
    referrerHost: 'www.baidu.com',
    utmSource: '知乎',
    utmMedium: 'social',
    utmCampaign: '秋季 菜谱',
  },
  registerTouch: {
    capturedAt: 2000,
    landingHost: 'cook.yunle.fun',
    landingPath: '/my',
    referrerHost: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
  },
}
