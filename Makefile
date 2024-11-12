# @file Данный Makefile устанавливает в систему контроллера WirenBoard сценарии.
#       Процесс включает перемещение в нужные места системы:
#         - Общие файлы для всех сценариев из корня и общих папок
#         - Потом копирует все файлы специфичных сценариев из подпапок
#       В итоге получаем установленные в системе конфиг, скрипты и модули

# DESTDIR задается по необходимости извне, по дефолту пустое
# DESTDIR=/
PREFIX=/usr

# Путь к папке со сценариями
SCENARIOS_ROOT := scenarios/

# Папка для схем и изображений в схеме
SCHEMA_DIR := schema/

# Целевые пути
CONFIG_DEST := $(DESTDIR)/etc
IMAGE_DEST := $(DESTDIR)/var/www/images
SCHEMA_DEST := $(DESTDIR)$(PREFIX)/share/wb-mqtt-confed/schemas
# Используем системный путь до скриптов /usr/share/wb-rules-system/rules
# так как /etc/wb-rules/* должно использоваться для пользовательских скриптов
RULES_DEST := $(DESTDIR)$(PREFIX)/share/wb-rules-system/rules
# Используем системный путь до модулей /usr/share/wb-rules-modules
# так как /etc/wb-rules-modules/* должно использоваться
# для пользовательских модулей
MODULES_DEST := $(DESTDIR)$(PREFIX)/share/wb-rules-modules

# Поиск папок сценариев внутри папки scenarios
SCENARIO_DIRS := $(wildcard $(SCENARIOS_ROOT)*)

# @note: Потенциально могут быть пробелы и спец символы в именах файлов
#        или папок - можно сделать проверку перед началом работы

# Предварительно вычисленные списки файлов для копирования
CONFIG_FILES := $(wildcard *.conf)
IMAGE_FILES := $(wildcard $(SCHEMA_DIR)*.png)
SCHEMA_FILES := $(wildcard $(SCHEMA_DIR)*.schema.json)

.PHONY: all dummy install

all: install

clean:
	@echo "This is a clean target"

dummy:
	@echo "This is a dummy target"

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
