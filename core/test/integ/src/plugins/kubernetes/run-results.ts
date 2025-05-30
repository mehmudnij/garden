/*
 * Copyright (C) 2018-2024 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import type { Garden } from "../../../../../src/garden.js"
import type { Provider } from "../../../../../src/config/provider.js"
import type { KubernetesConfig, KubernetesPluginContext } from "../../../../../src/plugins/kubernetes/config.js"
import { getDataDir, makeTestGarden } from "../../../../helpers.js"
import { randomString } from "../../../../../src/util/string.js"
import { expect } from "chai"
import { k8sGetRunResult } from "../../../../../src/plugins/kubernetes/run-results.js"
import { MAX_RUN_RESULT_LOG_LENGTH } from "../../../../../src/plugins/kubernetes/constants.js"
import { createActionLog } from "../../../../../src/logger/log-entry.js"
import { getRunResultCache } from "../../../../../src/plugins/kubernetes/results-cache.js"
import { getNamespaceStatus } from "../../../../../src/plugins/kubernetes/namespace.js"

describe("kubernetes Run results", () => {
  let garden: Garden
  let provider: Provider<KubernetesConfig>

  before(async () => {
    const root = getDataDir("test-projects", "container")
    garden = await makeTestGarden(root)
    provider = (await garden.resolveProvider({
      log: garden.log,
      name: "local-kubernetes",
    })) as Provider<KubernetesConfig>
  })

  after(async () => {
    garden.close()
  })

  describe("run-result logs trimming", () => {
    it("should trim logs when necessary", async () => {
      const ctx = await garden.getPluginContext({ provider, templateContext: undefined, events: undefined })
      const graph = await garden.getConfigGraph({ log: garden.log, emit: false })
      const action = graph.getRun("echo-task")

      const data = randomString(1024 * 1024)

      const k8sCtx = ctx as KubernetesPluginContext
      const namespaceStatus = await getNamespaceStatus({ ctx: k8sCtx, log: garden.log, provider: k8sCtx.provider })
      expect(namespaceStatus.namespaceUid).to.be.not.undefined
      const namespaceUid = namespaceStatus.namespaceUid!

      const result = {
        log: data,
        startedAt: new Date(),
        completedAt: new Date(),
        success: true,
      }
      const runResultCache = await getRunResultCache(ctx)
      const trimmed = await runResultCache.store({
        ctx,
        log: garden.log,
        keyData: { namespaceUid },
        action,
        result,
      })

      expect(trimmed).to.be.not.undefined
      expect(trimmed!.log.length).to.be.lte(MAX_RUN_RESULT_LOG_LENGTH)
      const actionLog = createActionLog({ log: garden.log, actionName: action.name, actionKind: action.kind })

      const stored = await k8sGetRunResult({
        ctx,
        log: actionLog,
        action,
      })

      expect(stored).to.exist
      expect(stored!.detail?.log.length).to.equal(trimmed!.log.length)

      const outputsLog = stored!.outputs.log as string
      expect(outputsLog.length).to.equal(trimmed!.log.length)
    })
  })
})
