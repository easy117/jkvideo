import { Platform } from 'react-native';

/**
 * Web 端将 B站图片 CDN URL 转为本地代理地址，注入正确 Referer 绕过防盗链。
 * Native 端直接返回原 URL（App 请求头由 axios 拦截器统一设置）。
 */
export function proxyImageUrl(url: string): string {
  if (!url) return url;
  if (Platform.OS === 'web') {
    return url.replace(
      /^https?:\/\/([a-z0-9]+\.hdslb\.com)/,
      'http://localhost:3001/bilibili-img/$1',
    );
  }
  // Native: force HTTPS so Release APK doesn't block cleartext HTTP
  return url.replace(/^http:\/\//, 'https://');
}
