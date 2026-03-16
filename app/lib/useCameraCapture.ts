import { useState } from "react"
import { createElement } from "react"
import { isMobileDevice, fileToBase64 } from "~/lib/camera-capture"
import { CameraModal } from "~/components/CameraModal"

export function useCameraCapture(
  onCapture: (base64: string, mimeType: string) => void,
) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const openCamera = () => {
    if (isMobileDevice()) {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/*"
      input.capture = "environment"
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const base64 = await fileToBase64(file)
        onCapture(base64, file.type || "image/jpeg")
      }
      input.click()
    } else {
      setIsModalOpen(true)
    }
  }

  const handleCapture = (base64: string, mimeType: string) => {
    setIsModalOpen(false)
    onCapture(base64, mimeType)
  }

  const cameraModal = isModalOpen
    ? createElement(CameraModal, {
        onCapture: handleCapture,
        onCancel: () => setIsModalOpen(false),
      })
    : null

  return { openCamera, cameraModal }
}
