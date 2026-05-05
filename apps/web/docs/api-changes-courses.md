# 课程播放量与评分接口对接文档

本文档供后端同学对接课程播放量和评分能力使用。当前前端调用位于 `src/services/courses.ts`，所有接口均走 Java Content 代理，前端以同源路径请求。

## 通用约定

- 鉴权：沿用现有登录态 Cookie / Sa-Token，前端请求会携带 `credentials: "include"`。
- 返回格式：建议统一使用 `{ "code": 200, "data": ... }`。
- 业务错误：非 200 时返回 `{ "code": <number>, "msg": "<message>" }`，前端会按 `code` 和 `msg` 判断特殊提示。

## 1. 增加课程播放量

`POST /project/play/course/addPlayCount`

Content-Type: `application/x-www-form-urlencoded; charset=UTF-8`

请求参数：

| 字段 | 类型            | 必填 | 说明                                 |
| ---- | --------------- | ---- | ------------------------------------ |
| `id` | string / number | 是   | 课程小节 ID，即课程列表 item 的 `id` |

示例请求体：

```txt
id=123
```

建议成功响应：

```json
{
  "code": 200,
  "data": {
    "playCount": 1024
  }
}
```

前端兼容读取字段：`playCount`、`count`、`views`。

## 2. 提交课程评分

`POST /project/play/course/score`

Content-Type: `application/x-www-form-urlencoded; charset=UTF-8`

请求参数：

| 字段    | 类型            | 必填 | 说明                                   |
| ------- | --------------- | ---- | -------------------------------------- |
| `id`    | string / number | 是   | 课程小节 ID，即课程列表 item 的 `id`   |
| `score` | string / number | 是   | 用户评分，当前前端传 `1` 到 `5` 的整数 |

示例请求体：

```txt
id=123&score=5
```

建议成功响应：

```json
{
  "code": 200,
  "data": {
    "averageScore": 4.8,
    "ratingCount": 36
  }
}
```

前端兼容读取字段：`averageScore`、`rating`、`score`；评分人数兼容 `ratingCount`。

## 3. 课程列表建议补充字段

当前课程列表接口：

`GET /project/list/course/type/title`

为了页面首屏能展示真实播放量和评分，建议每个课程 item 补充：

```json
{
  "id": 123,
  "playCount": 1024,
  "averageScore": 4.8,
  "ratingCount": 36
}
```

如果后端更适合单独查询，也可以新增批量查询接口：

`POST /project/play/course/stats`

请求：

```json
{
  "ids": [123, 124, 125]
}
```

响应：

```json
{
  "code": 200,
  "data": {
    "123": {
      "playCount": 1024,
      "averageScore": 4.8,
      "ratingCount": 36
    }
  }
}
```

## 4. 已对接的相关错误码

课程列表未登录：

```json
{
  "msg": "Not logged in!",
  "code": 302
}
```

前端提示：`暂未登录，请先登录即可获得课程资源`

视频链接无权限：

```json
{
  "msg": "No permission",
  "code": 403
}
```

前端提示：`暂无权限，您可以联系 business@fizzdragon.com 为您开通权限`
