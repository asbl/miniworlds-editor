import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { signatures, staleClasses } from '../../uml/model'
import type { useClassModel } from '../../uml/useModel'

/**
 * "Changed since the world was started": remember each class's source when the world becomes ready, and report the
 * classes whose source differs now. Lives above the class panel, so switching sidebar tabs does not forget it.
 */
export function useStaleClasses(classModel: ReturnType<typeof useClassModel>, worldActive: boolean): Set<string> {
  const [loadedSigs, setLoadedSigs] = useState<Record<string, string> | null>(null)
  const modelRef = useRef(classModel)
  modelRef.current = classModel
  useEffect(() => {
    if (worldActive && modelRef.current.model) setLoadedSigs(signatures(modelRef.current.model, modelRef.current.files))
  }, [worldActive])
  return useMemo(() => (classModel.model ? staleClasses(classModel.model, classModel.files, loadedSigs) : new Set<string>()), [classModel.model, classModel.files, loadedSigs])
}
