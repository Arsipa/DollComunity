; Если программа открыта — просим пользователя закрыть её самому (а не убиваем процесс),
; чтобы программа успела сохранить данные. «Отмена» прерывает установку/удаление.
; В тихом режиме (/S) при открытой программе установка прерывается.
!macro customCheckAppRunning
  vkd_check_running:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R0
    ${if} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Программа ${PRODUCT_NAME} сейчас открыта.$\r$\n$\r$\nЗакройте её (ваши данные сохранятся) и нажмите «Повтор»." /SD IDCANCEL IDRETRY vkd_wait_close
      Quit
      vkd_wait_close:
        Sleep 1500
        Goto vkd_check_running
    ${endIf}
!macroend

; При удалении программы библиотека пользователя сохраняется.
; Удаляется только если пользователь явно согласился (по умолчанию — «Нет»).
; При обновлении поверх старой версии вопрос не задаётся и данные не трогаются.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Удалить также вашу библиотеку (публикации, фотографии, резервные копии)?$\r$\n$\r$\nЕсли нажать «Нет», библиотека останется в папке$\r$\n$APPDATA\VK Doll Community$\r$\nи откроется снова после повторной установки." /SD IDNO IDYES vkd_delete_data IDNO vkd_keep_data
    vkd_delete_data:
      RMDir /r "$APPDATA\VK Doll Community"
      RMDir /r "$LOCALAPPDATA\VK Doll Community"
    vkd_keep_data:
  ${endIf}
!macroend
