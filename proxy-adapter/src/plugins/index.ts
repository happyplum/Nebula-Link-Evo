/**
 * 插件模块入口
 * 导出所有插件供主应用注册
 */

export { default as corsPlugin } from './01-cors.plugin.js';
export { default as swaggerPlugin } from './02-swagger.plugin.js';
export { default as errorHandlerPlugin } from './03-error-handler.plugin.js';
export { default as routesAutoloadPlugin } from './10-routes-autoload.plugin.js';
