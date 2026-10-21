import { useEffect, useState } from "react";

import { useAtomValue } from "../app-jotai";
import {
  libraryVersionAtom,
  listCollections,
  listScenes,
} from "../data/scenes";

import type { Collection, SceneMeta } from "../data/scenes";

/** every scene and collection, reloaded whenever the library changes */
export const useSceneLibrary = (enabled = true) => {
  const version = useAtomValue(libraryVersionAtom);
  const [library, setLibrary] = useState<{
    scenes: SceneMeta[];
    collections: Collection[];
  }>({ scenes: [], collections: [] });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    Promise.all([listScenes(), listCollections()]).then(
      ([scenes, collections]) => {
        if (!cancelled) {
          setLibrary({ scenes, collections });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version, enabled]);

  return library;
};
