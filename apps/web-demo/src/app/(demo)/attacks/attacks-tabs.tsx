"use client";

import { AnimatePresence, motion } from "motion/react";
import { useDemoRun } from "@/components/demo-run-provider";
import { useResearchMode } from "@/components/research-mode-provider";
import { AttackFlowTablist, type AttackFlowTab } from "./components/attack-flow-tablist";
import { AttackRunner } from "./attack-runner";
import { AttackPageIntro } from "./components/attack-page-intro";
import { PredicateAttackRunner } from "./predicate-attack-runner";

export function AttacksTabs({ serviceUrl }: { serviceUrl: string }) {
  const { enabled: research } = useResearchMode();
  const { mode, setMode } = useDemoRun();
  const activeTab: AttackFlowTab = mode === "b" ? "predicate" : "binding";

  function setActiveTab(tab: AttackFlowTab) {
    setMode(tab === "predicate" ? "b" : "a");
  }

  return (
    <div className="space-y-6">
      <AttackPageIntro />
      <div className="w-full space-y-4">
        <AttackFlowTablist activeTab={activeTab} onChange={setActiveTab} research={research} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            role="tabpanel"
            id={`attacks-panel-${activeTab}`}
            aria-labelledby={`attacks-tab-${activeTab}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {activeTab === "binding" ? (
              <AttackRunner serviceUrl={serviceUrl} />
            ) : (
              <PredicateAttackRunner serviceUrl={serviceUrl} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
