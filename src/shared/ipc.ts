export const IPC = {
  PRINT_CUSTOMER: 'print:customer',
  PRINT_KITCHEN: 'print:kitchen',
  PRINT_KITCHEN_TO: 'print:kitchenTo',
  PRINT_TEST: 'print:test',
  PRINT_TEST_BY_ID: 'print:testById',
  SETTINGS_GET_PRINTERS: 'settings:getPrinters',
  SETTINGS_SET_PRINTER: 'settings:setPrinter',
  SETTINGS_LIST_SYSTEM_PRINTERS: 'settings:listSystemPrinters',
  SETTINGS_GET_EXTRA_PRINTERS: 'settings:getExtraPrinters',
  SETTINGS_SET_EXTRA_PRINTER: 'settings:setExtraPrinter',
  SETTINGS_DELETE_EXTRA_PRINTER: 'settings:deleteExtraPrinter',
  SETTINGS_GET_CATEGORY_ROUTING: 'settings:getCategoryRouting',
  SETTINGS_SET_CATEGORY_ROUTING: 'settings:setCategoryRouting',
  SETTINGS_GET_RESTAURANT_ID: 'settings:getRestaurantId',
  SETTINGS_SET_RESTAURANT_ID: 'settings:setRestaurantId',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
