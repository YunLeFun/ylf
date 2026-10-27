import type { SupportProduct } from '@yunlefun/support-client'
import type { TicketMirrorPort, TicketMirrorRecord } from '@yunlefun/support-client/feishu'
import type { SupportServerClientOptions } from '@yunlefun/support-client/server'
import { buildSupportUrl, SupportApiError } from '@yunlefun/support-client'
import { createSupportServerClient } from '@yunlefun/support-client/server'

const product: SupportProduct = 'drive'
buildSupportUrl({ product, intent: 'feedback' })
const options: SupportServerClientOptions = { clientId: 'synthetic-server', keyId: 'synthetic-key', userId: 'synthetic_user', privateKey: 'synthetic-placeholder' }
const submit = () => createSupportServerClient(options).submitFeedback({ productId: product, category: 'problem', description: 'Synthetic type verification' }, 'synthetic-type-key')
const mirror: TicketMirrorPort = { upsert: async (_record: TicketMirrorRecord) => 'created' }
const error: Error = new SupportApiError('RATE_LIMITED', 429)
void submit
void mirror
void error
