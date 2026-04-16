# FizzDragon Server

NestJS 后端，负责 AI 智能体、剧本拆解 Pipeline、以及 Java 后端代理。

## 开发

```bash
# 从 monorepo 根目录
npx turbo dev --filter=server
```

## AI Assistant 调用的 Java 后端接口

所有接口通过 `WorkspaceService` 代理，需要透传用户的 cookie/token。

### 剧本大师 (Script Agent)

| 方法                  | HTTP | API 路径                                                 | 请求体                                       | 用途                     |
| --------------------- | ---- | -------------------------------------------------------- | -------------------------------------------- | ------------------------ |
| `batchAddEpisodes`    | POST | `/api/user/storyBoard/create`                            | `{ projectId, name }`                        | 逐个创建剧集（循环调用） |
| `batchCreateRoles`    | POST | `/api/ai/chat/batch/create/role`                         | `{ worldId, datas: [["name","desc"], ...] }` | 批量创建角色             |
| `batchCreateScenes`   | POST | `/api/ai/chat/batch/create/scene`                        | `{ worldId, datas: [["name","desc"], ...] }` | 批量创建场景             |
| `batchSaveScripts`    | POST | `/api/user/project/scripts/episode/batch/createOrUpdate` | `{ projectId, episodeIds, contents }`        | 批量保存剧本             |
| `saveStoryboardDraft` | POST | `/api/ai/chat/save/storyboard`                           | `{ episodeId, headers, rows }`               | 保存分镜草稿             |
| `listEpisodes`        | POST | `/api/user/world/list/episode`                           | `{ productId, page, pageSize }`              | 获取剧集列表             |

### 读取类 (Read Tools)

| 方法                   | HTTP | API 路径                                          | 请求体                             | 用途         |
| ---------------------- | ---- | ------------------------------------------------- | ---------------------------------- | ------------ |
| `getProjectDetail`     | POST | `/api/user/project/detail/{id}`                   | —                                  | 项目详情     |
| `listEpisodes`         | POST | `/api/user/world/list/episode`                    | `{ productId, page, pageSize }`    | 剧集列表     |
| `getWorldAssetPage`    | POST | `/api/user/world/list/world{role\|scene\|prop}`   | `{ worldId, page, pageSize }`      | 资产分页列表 |
| `getWorldAssetSummary` | POST | `/api/user/world/search/world{role\|scene\|prop}` | `{ worldId, name? }`               | 资产搜索     |
| `queryStoryboardRows`  | POST | `/api/user/shot/queryPage`                        | `{ storyBoardId, page, pageSize }` | 分镜行分页   |
| `getStoryboardSummary` | POST | `/api/user/shotColumn/list`                       | `{ storyBoardId }`                 | 分镜列列表   |

### 执行类 (Execute Tools)

| 方法                | HTTP | API 路径                                           | 请求体                                       | 用途           |
| ------------------- | ---- | -------------------------------------------------- | -------------------------------------------- | -------------- |
| `updateProject`     | POST | `/api/user/world/update/worldproduct`              | `{ id, name?, description? }`                | 更新项目       |
| `createEpisode`     | POST | `/api/user/storyBoard/create`                      | `{ projectId, name }`                        | 创建单集       |
| `updateEpisode`     | POST | `/api/user/world/update/episode`                   | `{ id, title? }`                             | 更新剧集       |
| `deleteEpisode`     | GET  | `/api/user/world/delete/episode?id=`               | —                                            | 删除剧集       |
| `saveEpisodeScript` | POST | `/api/user/project/scripts/episode/createOrUpdate` | `{ episodeId, content }`                     | 保存单集剧本   |
| `createCharacter`   | POST | `/api/user/world/create/worldrole`                 | `{ worldId, name, description? }`            | 创建角色       |
| `updateCharacter`   | POST | `/api/user/world/update/worldrole`                 | `{ id, name?, description? }`                | 更新角色       |
| `deleteCharacter`   | GET  | `/api/user/world/delete/worldrole?id=`             | —                                            | 删除角色       |
| `createScene`       | POST | `/api/user/world/create/worldscene`                | `{ worldId, name, description? }`            | 创建场景       |
| `updateScene`       | POST | `/api/user/world/update/worldscene`                | `{ id, name?, description? }`                | 更新场景       |
| `deleteScene`       | GET  | `/api/user/world/delete/worldscene?id=`            | —                                            | 删除场景       |
| `createProp`        | POST | `/api/user/world/create/worldprop`                 | `{ worldId, name, description? }`            | 创建道具       |
| `updateProp`        | POST | `/api/user/world/update/worldprop`                 | `{ id, name?, description? }`                | 更新道具       |
| `deleteProp`        | GET  | `/api/user/world/delete/worldprop?id=`             | —                                            | 删除道具       |
| `fillCell`          | POST | `/api/user/shotValue/input`                        | `{ shotId, columnKey, value }`               | 填写分镜单元格 |
| `batchCreateProps`  | POST | `/api/ai/chat/batch/create/prop`                   | `{ worldId, datas: [["name","desc"], ...] }` | 批量创建道具   |

### 后端服务地址

- **Java Studio**: `JAVA_STUDIO_URL`（所有 `/api/*` 接口）
- **Java Content**: `JAVA_CONTENT_URL`（`/user/*`, `/project/*`, `/content/*`, `/vedio/*`）

### 认证

所有请求需要透传用户的 `satoken` cookie。在代码中通过 `headers` 参数传递。
