# @file Данный Makefile устанавливает в систему контроллера WirenBoard сценарии.
#       Процесс включает перемещение в нужные места системы:
#         - Общие файлы для всех сценариев из корня и общих папок
#         - Потом копирует все файлы специфичных сценариев из подпапок
#       В итоге получаем установленные в системе конфиг, скрипты и модули

# DESTDIR задается по необходимости извне, по дефолту пустое
# DESTDIR=/
PREFIX=/usr

# Локальные пути в директории сборки
# Дирректория со сценариями
SCENARIOS_ROOT := scenarios/

# Директория для схем и изображений в схеме
SCHEMA_DIR := schema/

# Директория с общими файлами исходников нескольких сценариев
SRC_DIR := src/

# Целевые пути
CONFIG_DEST := $(DESTDIR)/etc
WB_CONFIGS_DEST := $(DESTDIR)/etc/wb-configs.d
IMAGE_DEST := $(DESTDIR)/var/www/images/wb-scenarios
SCHEMA_DEST := $(DESTDIR)$(PREFIX)/share/wb-mqtt-confed/schemas
# Используем системный путь до скриптов /usr/share/wb-rules-system/rules
# так как /etc/wb-rules/* должно использоваться для пользовательских скриптов
RULES_DEST := $(DESTDIR)$(PREFIX)/share/wb-rules-system/rules
# Используем системный путь до модулей /usr/share/wb-rules-modules
# так как /etc/wb-rules-modules/* должно использоваться
# для пользовательских модулей
MODULES_DEST := $(DESTDIR)$(PREFIX)/share/wb-rules-modules

# Целевой путь для скрипта wb-scenarios-reloader
SCRIPTS_DEST := $(DESTDIR)$(PREFIX)/lib/wb-scenarios

# Целевой путь для пункта меню HomeUI
HOMEUI_MENU_DEST := $(DESTDIR)$(PREFIX)/share/wb-mqtt-homeui/custom-menu

# Поиск папок сценариев внутри папки scenarios
SCENARIO_DIRS := $(wildcard $(SCENARIOS_ROOT)*)
SRC_MODULE_FILES := $(wildcard $(SRC_DIR)*.mod.js)

# @note: Потенциально могут быть пробелы и спец символы в именах файлов
#        или папок - можно сделать проверку перед началом работы

# Предварительно вычисленные списки файлов для копирования
CONFIG_FILES := $(wildcard *.conf)
IMAGE_FILES := $(wildcard $(SCHEMA_DIR)*.png)
SCHEMA_FILES := $(wildcard $(SCHEMA_DIR)*.schema.json)
WB_CONFIG_FILE := 45wb-scenarios
# Файл скрипта сервиса перезагрузки сценариев
RELOADER_SCRIPT := wb-scenarios-reloader
# Файл меню для HomeUI
MENU_FILE := scenario-navigation.json

.PHONY: all dummy install

all: install

clean:
	@echo "This is a clean target"

dummy:
	@echo "This is a dummy target"

# @note: Используем везде цикл а не просто install, чтобы иметь возможность
#        видеть в логе какие именно файлы копируются поштучно
install:
	@echo "Starting installation process..."

	@# Копирование всех конфигурационных файлов из корня проекта
	@$(foreach file,$(CONFIG_FILES),\
		echo "Copying $(file) to $(CONFIG_DEST)";\
		install -Dm644 $(file) -t $(CONFIG_DEST);)

	@# Копирование изображений из папки schema
	@$(foreach file,$(IMAGE_FILES),\
		echo "Copying image $(file) to $(IMAGE_DEST)";\
		install -Dm644 $(file) -t $(IMAGE_DEST);)

	@# Копирование схем из папки schema
	@$(foreach file,$(SCHEMA_FILES),\
		echo "Copying schema $(file) to $(SCHEMA_DEST)";\
		install -Dm644 $(file) -t $(SCHEMA_DEST);)

	@# Установка общих файлов сценариев из папки src
	@if [ -z "$(SRC_MODULE_FILES)" ]; then \
		echo "No .mod.js files found in dir."; \
	else \
		$(foreach file,$(SRC_MODULE_FILES),\
			echo "Copying module file $(file) to $(MODULES_DEST)";\
			install -Dm644 $(file) -t $(MODULES_DEST);) \
	fi

	@# Установка общего файла инициализации сценариев
	@echo "Copying scenarios/scenario-init-main.js to $(RULES_DEST)"
	@install -Dm644 scenarios/scenario-init-main.js -t $(RULES_DEST)/

	@# Установка скрипта wb-scenarios-reloader
	@echo "Copying $(RELOADER_SCRIPT) to $(SCRIPTS_DEST)"
	@install -Dm755 $(RELOADER_SCRIPT) -t $(SCRIPTS_DEST)/

	@echo "Copying $(WB_CONFIG_FILE) to $(WB_CONFIGS_DEST)"
	@install -Dm644 $(WB_CONFIG_FILE) -t $(WB_CONFIGS_DEST)/

	@# Установка файла меню для HomeUI
	@echo "Copying $(MENU_FILE) to $(HOMEUI_MENU_DEST)"
	@install -Dm644 $(MENU_FILE) -t $(HOMEUI_MENU_DEST)/

	@# Установка каждого сценария из подпапок
	@$(foreach dir,$(SCENARIO_DIRS),\
		echo "Installing from directory $(dir)...";\
		$(MAKE) -s install-$(dir);)

define INSTALL_SCENARIO_TEMPLATE
install-$(1):
	@echo "  + Processing directory $(1)..."
	@# Используем уникальные имена *_$(1) чтобы не перезаписывать переменные
	$(eval MODULE_FILES_$(1) := $(wildcard $(1)/*.mod.js))
	$(eval JS_FILES_$(1) := $(wildcard $(1)/*.js))
	@# Собираем все файлы .js, кроме модулей (заканчиваются на .mod.js)
	$(eval RULE_FILES_$(1) := $(filter-out $(MODULE_FILES_$(1)), $(JS_FILES_$(1))))

	@if [ -n "$$(RULE_FILES_$(1))" ]; then \
		echo "    - Copying rule files: $$(RULE_FILES_$(1)) to $(RULES_DEST)";\
		install -Dm644 $$(RULE_FILES_$(1)) -t $(RULES_DEST);\
	fi

	@if [ -n "$$(MODULE_FILES_$(1))" ]; then \
		echo "    - Copying module files: $$(MODULE_FILES_$(1)) to $(MODULES_DEST)";\
		install -Dm644 $$(MODULE_FILES_$(1)) -t $(MODULES_DEST);\
	fi

.PHONY: dummy install-$(1)
endef

$(foreach dir,$(SCENARIO_DIRS),$(eval $(call INSTALL_SCENARIO_TEMPLATE,$(dir))))
