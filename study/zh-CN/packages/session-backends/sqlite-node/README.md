> 中文阅读版；原文路径：`packages/session-backends/sqlite-node/README.md` · [英文原文](../../../../../packages/session-backends/sqlite-node/README.md) · [阅读索引](../../../README.md)
> 对应提交：`7ca5b1bde4d3dafe3f7555407bd96043b5b660ee` · 原文 SHA-256：`95b85510009cf78a821cc2a0a90e3ea9d2a81ecaa03381fa297e6e7ed2932b30`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="earendil-workspi-session-backend-sqlite-node"></a>
# @earendil-works/pi-session-backend-sqlite-node

使用 Node `node:sqlite`、面向 `@earendil-works/pi-agent-core` 的 Session 后端。

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from "@earendil-works/pi-session-backend-sqlite-node";

const repository = new SqliteSessionRepo({
  directory: "/var/lib/pi/sessions",
  databaseFactory: createNodeSqliteFactory(),
});

const session = await repository.create({}, BACKGROUND_CONTEXT);
const main = await session.createBranch("main", null, BACKGROUND_CONTEXT);
await main.appendMessage(
  { role: "user", content: "hello", timestamp: Date.now() },
  BACKGROUND_CONTEXT,
);
await session.close(BACKGROUND_CONTEXT);
await repository.close(BACKGROUND_CONTEXT);
```

默认布局在 `directory` 下为每个 Session 创建一个文件。ID 仅含 ASCII 字母、数字、`_`、`-` 时，保留 `{sessionId}.sqlite`；其他 ID 使用以 `~` 开头、对 UTF-16 代码单元进行 base64url 编码的文件名。持久 ID 不变，返回/列举的元数据包含规范化物理路径。传入 `databasePath` 可将多个 Session 放入受支持的共享容器；需要时会创建父目录。

数据库工厂区分有意创建、不创建文件的读写打开及不创建文件的只读打开。Session `open()` 和删除拒绝配置仓库之外的元数据，绝不创建缺失数据库。列举采用只读、尽力而为方式。分叉有意允许外部源元数据路径：只读访问那个精确且已存在的容器，绝不替换为同 ID 的活动本地 Session。

宿主生命周期保证每个 Session 只有一个可写所有者。此后端不承担该职责。不支持另一个进程直接打开同一 Session 写入。仓库拒绝同 ID 在本地重叠的 create/open/fork/delete 所有权，但不实现跨进程租约、锁、隔离、心跳或接管。删除前，宿主必须关闭 worker。

源在同一仓库内打开时，分叉将快照排入该源提交队列。其他源（包括由活动 Session worker 持有的源）使用独立只读连接及一个延迟开启的 WAL 事务；快照保持打开期间，后续 worker 提交仍可完成。共享容器删除只移除选中 Session 的行。仓库 close 在报告错误前，会等待每个已打开 Session 的清理尝试。此包不导出搜索服务或 FTS 索引；搜索属于独立的 S3 投影。
