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

# Поиск папок сценариев внутри папки scenarios
SCENARIO_DIRS := $(wildcard $(SCENARIOS_ROOT)*)

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
		echo "Copying $(file) to $(DESTDIR)/etc";\
		install -Dm644 $(file) $(DESTDIR)/etc;)

	@# Копирование изображений из папки schema
	@$(foreach file,$(IMAGE_FILES),\
		echo "Copying image $(file) to $(DESTDIR)/var/www/images";\
		install -Dm644 $(file) $(DESTDIR)/var/www/images;)

	@# Копирование схем из папки schema
	@$(foreach file,$(SCHEMA_FILES),\
		echo "Copying schema $(file) to $(DESTDIR)$(PREFIX)/share/wb-mqtt-confed/schemas";\
		install -Dm644 $(file) $(DESTDIR)$(PREFIX)/share/wb-mqtt-confed/schemas;)

	@# Установка каждого сценария из подпапок
	@$(foreach dir,$(SCENARIO_DIRS),\
		echo "Installing from directory $(dir)...";\
		$(MAKE) -s install-$(dir);)

define TEMPLATE
install-$(1):
	@echo "  + Processing directory $(1)..."
	@# Собираем все файлы .js, кроме модулей (заканчиваются на .mod.js)
	$(eval RULE_FILES := $(filter-out $(wildcard $(1)/*.mod.js), $(wildcard $(1)/*.js)))
	$(eval MODULE_FILES := $(wildcard $(1)/*.mod.js))

	@# Используем системный путь до скриптов /usr/share/wb-rules-system/rules
	@# так как /etc/wb-rules/* должно использоваться для пользовательских скриптов
	@if [ -n "$(RULE_FILES)" ]; then \
		echo "    - Copying rule files: $(RULE_FILES) to $(DESTDIR)$(PREFIX)/share/wb-rules-system/rules";\
		install -Dm644 $(RULE_FILES) $(DESTDIR)$(PREFIX)/share/wb-rules-system/rules;\
	fi

	@# Используем системный путь до модулей /usr/share/wb-rules-modules
	@# так как /etc/wb-rules-modules/* должно использоваться для пользовательских модулей
	@if [ -n "$(MODULE_FILES)" ]; then \
		echo "    - Copying module files: $(MODULE_FILES) to $(DESTDIR)$(PREFIX)/share/wb-rules-modules";\
		install -Dm644 $(MODULE_FILES) $(DESTDIR)$(PREFIX)/share/wb-rules-modules;\
	fi

.PHONY: dummy install-$(1)
endef

$(foreach dir,$(SCENARIO_DIRS),$(eval $(call TEMPLATE,$(dir))))
