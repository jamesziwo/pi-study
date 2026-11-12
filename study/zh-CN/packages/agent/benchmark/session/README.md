> 中文阅读版；原文路径：`packages/agent/benchmark/session/README.md` · [英文原文](../../../../../../packages/agent/benchmark/session/README.md) · [阅读索引](../../../../README.md)
> 对应提交：`32d6520b9ecc37c999384bec962fe7ec8a6c48d1` · 原文 SHA-256：`eccbaea04d574880b788495309230a952b1622bd6167b4e7cf2d5d8bfd6788c8`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="session-benchmarks"></a>
# 会话基准测试

在 packages/agent 目录运行下列命令。

基准使用确定性合成数据，不声称复现生产流量。存储和仓库分叉数据集是用户消息条目的线性分支，文本载荷固定为 256 字节，ID 确定，初始填充事务每批 250 条。仓库目录数据集包含确定性的已关闭会话。

<a id="timing"></a>
## 耗时

计时套件对 storage-targets.ts 和 session-repo-targets.ts 中每个目标运行场景。读取场景为每个后端/数据集复用一个不可变夹具，计时前校验一次结果。每次预热及测量写入都在独立准备的夹具上执行一次，使条目数、序列号和持久产物从等价状态开始。各实现注册到同一 Vitest 套件，便于直接比较新增后端。

存储写入覆盖在 1k 条目合成分支上追加单条消息、100 消息事务及混合消息/寄存值/用量。仓库场景覆盖创建空会话、打开或删除已关闭空会话、列出 100/1k/10k 已关闭会话，以及分叉打开的 1k/10k 条目源会话的当前分支。夹具准备、事务生成和校验均在计时回调之外完成。

```sh
npm run bench:session:timing
npm run bench:session:timing -- -t "scan latest"
```

<a id="loaded-footprint"></a>
## 加载后的内存占用

内存分析为每个后端/数据集组合启动新的 Node.js 进程并强制 GC。基线在生成和导入数据集前记录，因此结果包含保留的载荷和后端结构。临时生成数据应在最终读取前被回收，但 RSS 仍可能反映分配器增长。

```sh
npm run bench:session:memory
```

<a id="storage-allocation-sampling"></a>
## 存储分配采样

分配分析预先构造全部事务，再采样提交期间的分配，排除合成载荷生成。报告估算的累计分配字节数，包括后来回收的对象，以及采样中最大的分配位置。V8 采样为近似结果，不提供精确对象数量。

```sh
npm run bench:session:allocations
```

计时结果不是 CI 性能门禁。应在其他任务空闲的机器上运行，并比较相同硬件与 Node.js 版本产生的结果。
