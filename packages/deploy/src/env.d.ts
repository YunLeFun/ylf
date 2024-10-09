// shim for process.env
declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * Cloudflare API Token
     * @see https://dash.cloudflare.com/profile/api-tokens
     */
    CLOUDFLARE_API_TOKEN: string
    /**
     * 飞书消息推送 webhook 地址
     */
    FEISHU_NOTIFICATION_WEBHOOK_URL: string
  }
}
