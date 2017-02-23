;; emacs configuration for the markerMapViewer/Dav127 project

;; if you re-load this file, first use (dir-locals-clear-alist-and-cache)

;;------------------------------------------------------------------------------

;; The path of this directory.
;; Used to calculate the git work-tree root dir.
(setenv "MMV_r" (file-name-directory load-file-name))

;;------------------------------------------------------------------------------
;; This configuration is equivalent to ./.dir-locals.el
;;
;; To use .dir-locals.el, mv it to the root of the git work-tree,
;; so it will apply to all .js files in all sub-dirs
;;
;; To use this file : (load-file "$MMV1/resources/emacs_config.el")
;;
;; The main difference between these two alternatives approaches is  :
;; The .dir-locals.el is loaded and applied automatically, whereas the file
;; defining dir-locals-set-class-variables has to be loaded explicitly.
;;
;; refn :
;; www.gnu.org/software/emacs/manual/html_node/emacs/Directory-Variables.html
;; www.emacswiki.org/emacs/Js2Mode
;;
;; project-root-directory is the top-level directory of the git work-tree.
;;
(dir-locals-set-class-variables
 'project-root-directory
 '(
   (js-mode
    . ((c-basic-offset . 2)
       (tab-width . 2)
       (js-indent-level . 2)
       ))
   (js2-mode
    . ((c-basic-offset . 2)
       (indent-tabs-mode . nil)
       (tab-width . 2)
       (js-indent-level . 2)
       (js2-basic-offset . 2)
       (js2-pretty-multiline-declarations . nil)
       ))
   )
 )

;; Define the path project-root-directory.
;;
;; Testing suggests the directory path-name of dir-locals-set-directory-class
;; which the settings apply to is a fixed path string, not a reg-exp.
;; To make this code flexible wrt directory path, the path of the git work-tree
;; is calculated and the settings are configured to apply for that tree.
(dir-locals-set-directory-class
 (replace-regexp-in-string "resources/$" ""  (getenv "MMV_r") )
 'project-root-directory)


;; Undo the effect of the above config additions.
(defun dir-locals-clear-alist-and-cache ()
  "Reset the variables dir-locals-class-alist and dir-locals-directory-cache to their initial values."
  (interactive nil)

  (setq dir-locals-directory-cache '())
  (setq dir-locals-class-alist '())
  )


;;------------------------------------------------------------------------------

