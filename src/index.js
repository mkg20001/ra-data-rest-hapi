import { stringify } from 'query-string'
import {
  fetchUtils,
  GET_LIST,
  GET_ONE,
  GET_MANY,
  GET_MANY_REFERENCE,
  CREATE,
  UPDATE,
  UPDATE_MANY,
  DELETE,
  DELETE_MANY
} from 'react-admin'

/**
 * Maps admin-on-rest queries to a rest-hapi powered REST API
 *
 * @see https://github.com/JKHeadley/rest-hapi
 * @example
 * GET_LIST     => GET http://my.api.url/posts?$sort=title&$limit=24&$page=1
 * GET_ONE      => GET http://my.api.url/posts/123
 * GET_MANY     => GET http://my.api.url/posts/123, GET http://my.api.url/posts/456, GET http://my.api.url/posts/789
 * UPDATE       => PUT http://my.api.url/posts/123
 * CREATE       => POST http://my.api.url/posts/123
 * DELETE       => DELETE http://my.api.url/posts/123
 */
export default (apiUrl, httpClient = fetchUtils.fetchJson) => {
  const getQueryForParams = (params) => {
    const { page, perPage } = params.pagination
    const { field, order } = params.sort
    if (field) {
      params.filter.$sort = (order === 'DESC' ? '-' : '') + field
      /* A set of fields to sort by.
      Including field name indicates it should be sorted ascending, while prepending '-' indicates descending.
      The default sort direction is 'ascending' (lowest value to highest value).
      Listing multiplefields prioritizes the sort starting with the first field listed */
    }
    if (params.filter.q != null) {
      params.filter.$term = params.filter.q
      delete params.filter.q
    }
    return Object.assign(
      fetchUtils.flattenObject(params.filter), // add filter as is, e.g. name=john
      {$limit: perPage, $page: page}, // pagination
      /* Rest-Hapi docs:
      A set of fields to sort by.
      Including field name indicates it should be sorted ascending, while prepending '-' indicates descending.
      The default sort direction is 'ascending' (lowest value to highest value).
      Listing multiplefields prioritizes the sort starting with the first field listed */
      field ? {$sort: (order === 'DESC' ? '-' : '') + (field === 'id' ? '_id' : field)} : {} // optional field sort
    )
  }

  const cleanData = (params) => {
    const clean = Object.assign({}, params.data)
    delete clean.id
    delete clean.createdAt
    delete clean.updatedAt
    delete clean.deletedAt
    delete clean.isDeleted
    return JSON.stringify(clean)
  }

  /**
     * @param {String} type One of the constants appearing at the top if this file, e.g. 'UPDATE'
     * @param {String} resource Name of the resource to fetch, e.g. 'posts'
     * @param {Object} params The data request params, depending on the type
     * @returns {Object} { url, options } The HTTP request parameters
     */
  const convertDataRequestToHTTP = (type, resource, params) => {
    let url = ''
    const options = {}
    switch (type) {
      case GET_LIST: {
        const query = getQueryForParams(params)
        url = `${apiUrl}/${resource}?${stringify(query)}`
        break
      }
      case GET_ONE:
        url = `${apiUrl}/${resource}/${params.id}`
        break
      case GET_MANY_REFERENCE: {
        const query = getQueryForParams(params)
        query[params.target] = params.id
        url = `${apiUrl}/${resource}?${stringify(query)}`
        break
      }
      case UPDATE:
        url = `${apiUrl}/${resource}/${params.id}`
        options.method = 'PUT'
        options.body = cleanData(params)
        break
      case CREATE:
        url = `${apiUrl}/${resource}`
        options.method = 'POST'
        options.body = cleanData(params)
        break
      case DELETE:
        url = `${apiUrl}/${resource}/${params.id}`
        options.method = 'DELETE'
        break
      case GET_MANY: {
        url = `${apiUrl}/${resource}?${params.ids.map(_id => stringify({_id})).join('&')}`
        break
      }
      default:
        throw new Error(`Unsupported fetch action type ${type}`)
    }
    return { url, options }
  }

  /**
     * @param {Object} response HTTP response from fetch()
     * @param {String} type One of the constants appearing at the top if this file, e.g. 'UPDATE'
     * @param {String} resource Name of the resource to fetch, e.g. 'posts'
     * @param {Object} params The data request params, depending on the type
     * @returns {Object} Data response
     */
  const convertHTTPResponse = (response, type, resource, params) => {
    const { json } = response
    switch (type) {
      case GET_LIST:
      case GET_MANY:
      case GET_MANY_REFERENCE:
        return {
          data: json.docs.map(d => (d.id = d._id) && delete d._id && d),
          total: json.items.total
        }
      case CREATE:
        params.data.id = params.data._id
        delete params.data._id
        return { data: params.data }
      default:
        json.id = json._id
        delete json._id
        return { data: json }
    }
  }

  /**
     * @param {string} type Request type, e.g GET_LIST
     * @param {string} resource Resource name, e.g. "posts"
     * @param {Object} payload Request parameters. Depends on the request type
     * @returns {Promise} the Promise for a data response
     */
  return (type, resource, params) => {
    // json-server doesn't handle filters on UPDATE route, so we fallback to calling UPDATE n times instead
    if (type === UPDATE_MANY) {
      return Promise.all(
        params.ids.map(id =>
          httpClient(`${apiUrl}/${resource}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(params.data)
          })
        )
      ).then(responses => ({
        data: responses.map(response => response.json)
      }))
    }
    // json-server doesn't handle filters on DELETE route, so we fallback to calling DELETE n times instead
    if (type === DELETE_MANY) {
      return Promise.all(
        params.ids.map(id =>
          httpClient(`${apiUrl}/${resource}/${id}`, {
            method: 'DELETE'
          })
        )
      ).then(responses => ({
        data: responses.map(response => response.json)
      }))
    }
    const { url, options } = convertDataRequestToHTTP(
      type,
      resource,
      params
    )
    return httpClient(url, options).then(response =>
      convertHTTPResponse(response, type, resource, params)
    )
  }
}
